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
		this.ticker = setInterval(this.tick.bind(this), Game.tick_length);
		if (ws && req) this.add(ws, req);
	}

	send_to_all(type, from, message = Symbol(), send_to_me = false, send_username = false) {
		for (const player of this.players) {
			if (!send_to_me && player === from) continue;
			const obj = { type, message, id: from.id };
			if (send_username) {
				obj.username = from.username;
				obj.color = from.color;
			}
			player.ws.send(JSON.stringify(obj));
		}
	}

	destroy() {
		clearInterval(this.ticker);
	}

	tick() {
		for (const player of this.players) {
			if (player.speed[0] === 0 && player.speed[1] === 0) continue;
			player.position[0] += player.speed[0];
			player.position[1] += player.speed[1];
			this.send_to_all('position', player, player.position, true);
		}
	}

	add(ws, req) {
		new Player(ws, this, parse(req.url, true).query.username);
	}

	remove(player) {
		this.players.delete(player);
		this.send_to_all('bye', player);
	}

	static max_players = Infinity;
	static valid_speeds = new Set([-1, 0, 1]);
	static speed = 10;
	static tick_length = 50;
}

class Player {
	position = [0, 0];
	speed = [0, 0];
	color = random_color();

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
				game.send_to_all('message', this, String(data.message));
			} else if (
				data.type === 'position' &&
				Game.valid_speeds.has(data.x) &&
				Game.valid_speeds.has(data.y)) {
				this.speed = [data.x * Game.speed, data.y * Game.speed];
			}
		});

		ws.on('close', () => game.remove(this));

		game.players.add(this);
		game.send_to_all('position', this, this.position, false, true);

		for (const player of game.players) {
			ws.send(JSON.stringify({
				type: 'position',
				id: player.id,
				message: player.position,
				username: player.username,
				color: player.color
			}));
		}
	}

	static size = 50;
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

function random_color() {
	return `hsl(${360 * Math.random()},100%,${Math.random() * 50 + 20}%)`;
}