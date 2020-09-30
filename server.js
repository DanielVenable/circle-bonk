'use strict';

const { Server } = require('ws'),
	{ createServer } = require('http'),
	{ readFile } = require('fs').promises,
	{ parse } = require('url'),
	port = +process.argv[2] || 80,
	file = readFile(__dirname + '/game.html');

class Game {
	id = 0;
	players = new Set;

	constructor(ws, req) {
		this.ticker = setInterval(this.tick.bind(this), 100);
		if (ws && req) {
			const player = this.add(ws, req);
			ws.on('close', () => this.players.delete(player));
		}
	}

	send_to_all(type, from, message, send_to_me) {
		for (const player of this.players) {
			if (!send_to_me && player === from) continue;
			player.ws.send(JSON.stringify({
				type, from: from.username, id: from.id, message
			}));
		}
	}

	destroy() {
		clearInterval(this.ticker);
	}

	tick() {
		for (const player of this.players) {
			player.position[0] += player.speed[0];
			player.position[1] += player.speed[1];
			this.send_to_all('position', player, player.position, true);
		}
	}

	add(ws, req) {
		const player = new Player(ws, this, parse(req.url, true).query.username);
		this.players.add(player);
		return player;
	}

	static max_players = Infinity;
	static valid_speeds = new Set([-1, 0, 1]);
	static speed = 10;
}

class Player {
	position = [0, 0];
	speed = [0, 0];

	constructor(ws, game, username) {
		this.username = username;
		this.ws = ws;
		this.game = game;
		this.id = game.id++;
		ws.send(JSON.stringify({
			type: 'id', id: this.id
		}));

		ws.on('message', data => {
			try {
				data = JSON.parse(data);
			} catch {
				return;
			}
			if (data.type === 'message') {
				game.send_to_all('message', this, String(data.message), false);
			} else if (
				data.type === 'position' &&
				Game.valid_speeds.has(data.x) &&
				Game.valid_speeds.has(data.y)) {
				this.speed = [data.x * Game.speed, data.y * Game.speed];
			}
		});
	}
}

const server = createServer(async (req, res) => {
	res.setHeader('Content-Type', 'text/html');
	res.statusCode = 200;
	res.end(await file);
});

const ws_server = new Server({ server });

server.listen(port, () => console.log('Server running on http://localhost:%d', port));

const games = [new Game];

ws_server.on('connection', (ws, req) => {
	for (const game of games) {
		if (game.players.size < Game.max_players) {
			game.add(ws, req);
			return;
		}
	}
	games.push(new Game(ws, req));
});