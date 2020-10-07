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
	terrain = terrains[Math.floor(Math.random() * terrains.length)];

	constructor(ws, req) {
		this.ticker = setInterval(this.tick.bind(this), Game.tick_length);
		if (ws && req) new Player(ws, this, get_username(req));
	}

	send_to_all(type, from, message, send_to_me = false, send_username = false) {
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
		const arr = [...this.players];
		for (let i = 0; i < arr.length; i++) {
			const player = arr[i];
			add(player.position, player.speed);
			for (let j = i + 1; j < arr.length; j++) {
				collide_players(player, arr[j]);
			}
			add(player.speed, player.accel);
			player.speed[0] *= Game.friction;
			player.speed[1] *= Game.friction;
			this.send_to_all('position', player, player.position, true);
			if (player.is_overlapping_wall()) {
				this.send_to_all('die', player, Symbol(), true);
				this.players.delete(player);
				player.ws.close();
			}
		}
	}

	remove(player) {
		this.players.delete(player);
		this.send_to_all('bye', player, Symbol());
	}

	static max_players = Infinity;
	static valid_speeds = new Set([-1, 0, 1]);
	static tick_length = 50;
	static friction = 0.95;
}

class Player {
	position = [12 + Math.random() * 30, 12 + Math.random() * 30];
	speed = [0, 0];
	accel = [0, 0];
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
			} else if (data.type === 'position') {
				const norm = Math.sqrt(data.x ** 2 + data.y ** 2);
				if (isNaN(norm)) return;
				this.accel = [
					data.x * Player.accel / norm || 0,
					data.y * Player.accel / norm || 0];
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
		ws.send(JSON.stringify({
			type: 'wall',
			message: game.terrain.walls
		}));
	}

	is_overlapping_wall() {
		const [x, y] = this.position;
		for (const [x1, y1, width, height] of this.game.terrain.walls) {
			if (x + Player.radius > x1 && x - Player.radius < x1 + width &&
				y + Player.radius > y1 && y - Player.radius < y1 + height) {
				let is_below, is_right;
				if ((is_right = x1 < x) && x < x1 + width ||
					(is_below = y1 < y) && y < y1 + height ||
					(is_right ? x1 + width - x : x1 - x) ** 2 +
					(is_below ? y1 + height - y : y1 - y) ** 2 <
					Player.sq_radius
				) {
					return true;
				}
			}
		}
		return false;
	}

	static radius = 5;
	static sq_radius = Player.radius ** 2;
	static accel = 0.25;
	static max_name_length = 30;
}

const server = createServer(async (req, res) => {
	res.setHeader('Content-Type', 'text/html');
	res.statusCode = 200;
	res.end(await file);
});

const ws_server = new Server({ server });

server.listen(port, () => console.log('Server running on http://localhost:%d', port));

const games = [];

ws_server.on('connection', (ws, req) => {
	const username = get_username(req);
	if (username.length > Player.max_name_length) return;
	for (const game of games) {
		if (game.players.size < Game.max_players) {
			return new Player(ws, game, username);
		}
	}
	games.push(new Game(ws, req));
});

function random_color() {
	return `hsl(${360 * Math.random()},100%,${Math.random() * 50 + 20}%)`;
}

function add(v1, v2) {
	for (let i = 0; i < v1.length; i++) {
		v1[i] += v2[i];
	}
}

function get_username({ url }) {
	return String(parse(url, true).query.username);
}

function collide_players(p1, p2) {
	const x = (p2.position[0] - p1.position[0]),
		y = (p2.position[1] - p1.position[1]);
	const distance = Math.sqrt(x ** 2 + y ** 2);
	if (distance > Player.radius * 2) return;
	const norm_x = x / distance, norm_y = y / distance;
	const speed = (p1.speed[0] - p2.speed[0]) * norm_x + (p1.speed[1] - p2.speed[1]) * norm_y;
	if (speed <= 0) return;
	p1.speed[0] -= speed * norm_x;
	p1.speed[1] -= speed * norm_y;
	p2.speed[0] += speed * norm_x;
	p2.speed[1] += speed * norm_y;
}

const terrains = [
	{
		walls: [
			[ 55, 45, 305, 1 ],   [ 650, 260, 5, 1 ],   [ 125, 260, 525, 1 ],
			[ 530, 65, 1, 135 ],  [ 690, 125, 230, 1 ], [ 745, 145, 1, 410 ],
			[ 240, 295, 465, 1 ], [ 390, 335, 1, 155 ], [ 490, 395, 155, 1 ],
			[ 505, 505, 190, 1 ], [ 125, 380, 1, 175 ], [ 515, 470, 175, 1 ],
			[ 485, 470, 185, 1 ], [ 90, 125, 320, 1 ],  [ 450, 45, 1, 135 ],
			[ 240, 155, 1, 70 ],  [ 785, 85, 1, 25 ],   [ 610, 20, 1, 130 ],
			[ 790, 235, 70, 1 ],  [ 885, 285, 1, 140 ], [ 780, 360, 40, 1 ],
			[ 830, 565, 165, 1 ], [ 740, 625, 145, 1 ], [ 150, 585, 220, 1 ],
			[ 240, 405, 1, 70 ],  [ 445, 440, 1, 275 ], [ 435, 415, 1, 310 ],
			[ 505, 445, 115, 1 ], [ 485, 425, 1, 60 ],  [ 515, 455, 100, 1 ],
			[ 695, 450, 1, 80 ],  [ 700, 460, 1, 120 ], [ 30, 680, 120, 1 ],
			[ 35, 295, 75, 1 ],   [ 25, 100, 1, 145 ],  [ 35, 75, 1, 175 ],
			[ 15, 365, 1, 80 ],   [ 40, 555, 75, 1 ],   [ 305, 695, 1, 175 ],
			[ 0, 775, 125, 1 ],   [ 0, 855, 230, 1 ],   [ 5, 855, 195, 1 ],
			[ 15, 845, 150, 1 ],  [ 1000, 0, 1, 995 ],  [ 995, 5, 1, 990 ],
			[ 5, 5, 990, 1 ],     [ 5, 5, 1, 990 ],     [ 5, 995, 990, 1 ],
			[ 5, 990, 990, 1 ],   [ 5, 995, 990, 1 ],   [ 5, 980, 985, 1 ],
			[ 985, 0, 1, 975 ],   [ 990, 5, 1, 970 ],   [ 990, 5, 1, 970 ],
			[ 995, 5, 1, 970 ],   [ 595, 720, 275, 1 ], [ 590, 550, 1, 60 ],
			[ 455, 875, 440, 1 ], [ 765, 780, 1, 50 ],  [ 455, 775, 110, 1 ],
			[ 240, 720, 40, 1 ],  [ 120, 920, 285, 1 ], [ 115, 905, 275, 1 ],
			[ 215, 735, 1, 145 ], [ 195, 735, 1, 165 ], [ 195, 900, 1, 0 ],
			[ 195, 900, 1, 5 ],   [ 485, 770, 1, 45 ],  [ 470, 645, 270, 1 ],
			[ 535, 535, 1, 35 ],  [ 690, 490, 1, 100 ], [ 825, 455, 1, 125 ],
			[ 920, 195, 1, 125 ], [ 790, 430, 1, 90 ],  [ 920, 195, 1, 125 ],
			[ 995, 5, 1, 970 ],   [ 650, 775, 235, 1 ], [ 815, 815, 1, 50 ],
			[ 940, 715, 1, 195 ], [ 940, 350, 1, 140 ], [ 890, 530, 100, 1 ],
			[ 985, 25, 1, 955 ],  [ 975, 560, 1, 420 ], [ 915, 605, 60, 1 ],
			[ 915, 595, 60, 1 ],  [ 915, 125, 1, 465 ], [ 915, 160, 60, 1 ],
			[ 970, 5, 1, 155 ],   [ 910, 575, 70, 1 ],  [ 915, 590, 1, 5 ]
		]
	}
];