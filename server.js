'use strict';

process.chdir(__dirname);

const { format } = require('util'),
	{ Server } = require('ws'),
	{ createServer } = require('http'),
	{ readFile } = require('fs').promises,
	{ parse } = require('url'),
	{ sign, verify } = require('./code-generate'),
	port = +process.env.PORT || 3000;

const files = {
	game: readFile('game.html').then(String),
	home: readFile('home-page.html').then(String),
	favicon: readFile('favicon.svg').then(String),
	chatbox: readFile('chatbox.html').then(String),
	no_exist: readFile('no-exist.html').then(String)
}

class Game {
	id = 0;
	players = new Set;
	dead_guys = new Set;
	treasures = [];

	constructor(ws, username, is_public, type = 'normal') {
		this.is_public = is_public;
		this.ticker = setInterval(this.tick.bind(this), Game.tick_length);
		if (type === 'normal') {
			this.world = public_terrains[Math.floor(Math.random() * public_terrains.length)];
		} else if (type === 'soccer') {
			this.world = private_terrains.soccer;
		} else return;

		for (const treasure of this.world.treasures) {
			this.treasures.push(new Treasure(this, ...treasure));
		}

		if (this.world.teams) {
			this.scores = new Array(this.world.teams.length).fill(0);
		}
		new Player(ws, this, username);
	}

	send_to_all(type, from, send_to_me = false, send_username = false,
			message = Symbol()) {
		const obj = { type, message, id: from.id };
		if (send_username) {
			obj.name = from.username;
			obj.color = from.color;
		}
		const str = JSON.stringify(obj);
		for (const player of this.all_players()) {
			if (send_to_me || player !== from) player.ws.send(str);
		}
	}

	destroy() {
		clearInterval(this.ticker);
		public_games.delete(this);
		private_games.delete(keys.get(this));
	}

	tick() {
		for (const treasure of this.treasures) {
			add(treasure.position, treasure.speed);
			treasure.speed[0] *= Game.friction;
			treasure.speed[1] *= Game.friction;
			treasure.bounce_off_walls();
			if (this.world.teams) {
				team_loop: for (let i = 0; i < this.world.goals.length; i++) {
					for (const [x, y, width, height] of this.world.goals[i]) {
						if (overlap1d(x, width,
								treasure.position[0], Treasure.length) &&
							overlap1d(y, height,
								treasure.position[1], Treasure.length)) {
							treasure.position = this.world.treasures[
								this.treasures.indexOf(treasure)];
							treasure.speed = [0, 0];
							this.scores[i]++;
							break team_loop;
						}
					}
				}
			}
		}

		const arr = [...this.players];
		for (let i = 0; i < arr.length; i++) {
			const player = arr[i];
			add(player.position, player.speed);

			const x_min = player.position[0] - Player.min_show_player_x,
				x_max = player.position[0] + Player.min_show_player_x,
				y_min = player.position[1] - Player.min_show_player_y,
				y_max = player.position[1] + Player.min_show_player_y;

			function is_on_screen(player) {
				return player.position[0] > x_min && player.position[0] < x_max &&
					player.position[1] > y_min && player.position[1] < y_max;
			}

			for (let j = i + 1; j < arr.length; j++) {
				if (is_on_screen(arr[j])) {
					player.on_screen.push([ arr[j].id, arr[j].position ]);
					arr[j].on_screen.push([ player.id, player.position ]);
					collide_players(player, arr[j]);
				}
			}

			for (const dead of this.dead_guys) {
				if (is_on_screen(dead)) {
					dead.on_screen.push([ player.id, player.position ]);
				}
			}

			this.send_data(player, true);

			if (player.is_overlapping_wall()) {
				this.send_to_all('die', player, true);
				this.players.delete(player);
				this.dead_guys.add(player);
			} else {
				add(player.speed, player.accel);
				player.speed[0] *= Game.friction;
				player.speed[1] *= Game.friction;
			}
		}

		for (const dead of this.dead_guys) {
			this.send_data(dead, false);
		}
	}

	send_data(player, send_pos) {
		const obj = new Position_data(player.on_screen, send_pos && player.position);
		
		for (const treasure of this.treasures) {
			if (player.is_treasure_on_screen(treasure)) {
				treasure.collide_with(player);
				obj.treasures.push(treasure.position);
			}
		}

		player.ws.send(JSON.stringify(obj));

		player.on_screen = [];
	}

	remove(player) {
		this.players.delete(player);
		this.dead_guys.delete(player);
		this.send_to_all('bye', player);
		if (this.all_players().next().done) this.destroy();
	}

	*all_players() {
		yield* this.players;
		yield* this.dead_guys;
	}

	get_color() {
		if (this.world.teams) {
			const team_numbers = new Map;
			for (const color of this.world.teams) {
				team_numbers.set(color, 0);
			}
			for (const { color } of this.all_players()) {
				team_numbers.set(color, team_numbers.get(color) + 1);
			}
			let least_num = Infinity,
				least_values = [];
			for (const [color, num] of team_numbers) {
				if (num === least_num) least_values.push(color);
				else if (num < least_num) {
					least_num = num;
					least_values = [color];
				}
			}
			return random_array_elem(least_values);
		} else return random_color();
	}

	get_position(color) {
		if (this.world.teams) {
			return random_position(
				this.world.spawn[this.world.teams.indexOf(color)]);
		} else return random_position(this.world.spawn);
	}

	static max_players = Infinity;
	static tick_length = 50;
	static friction = 0.95;
}

class Position_data {
	type = 'position';
	treasures = [];

	constructor(message, pos) {
		this.message = message;
		if (pos) this.pos = pos;
	}
}

class Mobile {
	speed = [0, 0];

	constructor(game, x = 0, y = 0) {
		this.position = [x, y];
		this.game = game;
	}
}

class Player extends Mobile {
	on_screen = [];

	constructor(ws, game, username) {
		const color = game.get_color();
		super(game, ...game.get_position(color));
		this.color = color;
		this.username = username;
		this.ws = ws;
		this.id = game.id++;
		this.start();
		ws.send(JSON.stringify({
			type: 'id', id: this.id
		}));

		ws.on('message', data => {
			try {
				data = JSON.parse(data);
			} catch {
				return;
			}
			if (data.type === 'message' && !game.is_public) {
				game.send_to_all('message', this, false, false, String(data.message));
			} else if (data.type === 'position') {
				const norm = Math.sqrt(data.x ** 2 + data.y ** 2);
				if (isNaN(norm)) return;
				this.accel = [
					data.x * Player.accel / norm || 0,
					data.y * Player.accel / norm || 0];
			} else if (data.type === 'restart') {
				this.username = String(data.username);
				game.dead_guys.delete(this);
				this.start();
				if (!game.world.teams) this.color = random_color();
				this.position = game.get_position(this.color);
				this.speed = [0, 0];
			}
		});

		ws.on('close', () => game.remove(this));

		ws.send(JSON.stringify({
			type: 'wall',
			message: game.world.walls
		}));

		if (game.world.teams) ws.send(JSON.stringify({
			type: 'goal',
			color: game.world.teams,
			message: game.world.goals
		}));
	}

	is_overlapping_wall() {
		const [x, y] = this.position;
		for (const [x1, y1, width, height] of this.game.world.walls) {
			if (circle_touches_rect(x, y, Player.radius, x1, y1, width, height)) {
				return true;
			}
		}
		return false;
	}

	start() {
		this.accel = [0, 0];

		this.game.players.add(this);

		for (const player of this.game.players) {
			this.ws.send(JSON.stringify({
				type: 'player',
				id: player.id,
				name: player.username,
				color: player.color
			}));
		}

		this.game.send_to_all('player', this, false, true);
	}
	
	is_treasure_on_screen(treasure) {
		return overlap1d(this.position[0] - Player.half_board_width,
				Player.half_board_width * 2,
				treasure.position[0],
				Treasure.length) &&
			overlap1d(this.position[1] - Player.half_board_height,
				Player.half_board_height * 2,
				treasure.position[1],
				Treasure.length);
	}

	static radius = 5;
	static accel = 0.3;
	static max_name_length = 30;
	static half_board_width = 150;
	static half_board_height = 100;
	static min_show_player_x = Player.half_board_width + Player.radius;
	static min_show_player_y = Player.half_board_height + Player.radius;
}
Player.prototype.mass = 1;

class Treasure extends Mobile {
	bounce_off_walls() {
		const [x, y] = this.position;
		const center_x = x + Treasure.length / 2,
			center_y = y + Treasure.length / 2;
		for (const [x2, y2, width, height] of this.game.world.walls) {
			if (overlap1d(x, Treasure.length, x2, width) &&
					overlap1d(y, Treasure.length, y2, height)) {
				const b1 = this.bounce(y2, height, center_y, x2, width, center_x, 1);
				const b0 = this.bounce(x2, width, center_x, y2, height, center_y, 0);
				if (b1) this.speed[1] *= -1;
				if (b0) this.speed[0] *= -1;
			}
		}
	}

	bounce(a2, a_length, center_a, b2, b_length, center_b, num) {
		const multiplier = this.speed[num] < 0 ? 1 : -1;
		const wall_side_y = this.speed[num] < 0 ? a2 + a_length : a2;
		const y_dist = (wall_side_y - center_a) * multiplier +
			Treasure.length / 2;
		const x_dist = y_dist * this.speed[1 - num] / this.speed[num];
		const x_pos = center_b + x_dist * multiplier - Treasure.length / 2;
		if (overlap1d(x_pos, Treasure.length, b2, b_length)) {
			const y_pos = wall_side_y - (this.speed[num] < 0 ? 0 : Treasure.length);
			this.position = num ? [x_pos, y_pos] : [y_pos, x_pos];
			return true;
		}
	}

	collide_with(player) {
		if (!circle_touches_rect(...player.position, Player.radius,
			...this.position, Treasure.length, Treasure.length)) return;
		const x = player.position[0] - this.position[0] - Treasure.length / 2,
			y = player.position[1] - this.position[1] - Treasure.length / 2;
		bounce(x, y, Math.sqrt(x ** 2 + y ** 2), this, player);
	}

	static length = 10;
}
Treasure.prototype.mass = 0.5;

function random_position(rects) {
	const rect = random_array_elem(rects);
	return [0, 1].map(n => rect[n] + Math.random() * rect[2 + n]);
}

function circle_touches_rect(x, y, r, x1, y1, width, height) {
	if (x + r > x1 && x - r < x1 + width &&
		y + r > y1 && y - r < y1 + height) {
		let is_below, is_right;
		return (is_right = x1 < x) && x < x1 + width ||
			(is_below = y1 < y) && y < y1 + height ||
			(is_right ? x1 + width - x : x1 - x) ** 2 +
			(is_below ? y1 + height - y : y1 - y) ** 2 < r ** 2;
	}
}

function overlap1d(x1, width1, x2, width2) {
	return x1 <= x2 && x2 < x1 + width1 || x2 <= x1 && x1 < x2 + width2;
}

const server = createServer(async (req, res) => {
	if (req.headers['x-forwarded-proto'] !== 'https' &&
		process.env.NODE_ENV === 'production') {
		res.statusCode = 308;
		res.setHeader('Location', `https://${req.headers.host}${req.url}`);
		return res.end();
	}
	res.setHeader('Content-Type', 'text/html');
	res.statusCode = 200;
	switch (req.url) {
		case '/':
			return res.end(format(await files.home, random_color()));
		case '/play':
			return res.end(format(await files.game, '', ''));
		case '/favicon.svg':
			res.setHeader('Content-Type', 'image/svg+xml');
			return res.end(format(await files.favicon, random_color()));
		default:
			let regexp;
			if (regexp = req.url.match(/^\/code\/([\w\-]+)$/)) {
				res.setHeader('Content-Type', 'text/plain');
				return res.end(await sign(regexp[1]));
			} else if (regexp = req.url.match(/^\/play\/([\w\-]+)$/)) {
				return res.end(
					verify(regexp[1]) === undefined ?
						format(await files.no_exist, regexp[1]) :
						format(await files.game,
							await files.chatbox,
							'&id=' + regexp[1]));
			} else {
				res.statusCode = 404;
				return res.end();
			}
	}
});

const ws_server = new Server({ server });

server.listen(port, () =>
	console.log('Server running on port %d', port));

const private_games = new Map, keys = new WeakMap, public_games = new Set;

ws_server.on('connection', (ws, req) => {
	let { username, id } = parse(req.url, true).query;
	username = String(username);
	if (username.length > Player.max_name_length) return;
	if (id) {
		id = String(id);
		const game = private_games.get(id);
		if (game) new Player(ws, game, username);
		else {
			const mode = verify(id);
			if (mode) {
				const game = new Game(ws, username, false, mode);
				private_games.set(id, game);
				keys.set(game, id);
			}
		}
	} else {
		for (const game of public_games) {
			if (game.players.size < Game.max_players) {
				return new Player(ws, game, username);
			}
		}
		public_games.add(new Game(ws, username, true));	
	}
});

function random_color() {
	return `hsl(${360 * Math.random()},100%,${Math.random() * 50 + 20}%)`;
}

function add(v1, v2) {
	for (let i = 0; i < v1.length; i++) {
		v1[i] += v2[i];
	}
}

function collide_players(p1, p2) {
	const x = (p2.position[0] - p1.position[0]),
		y = (p2.position[1] - p1.position[1]);
	const distance = Math.sqrt(x ** 2 + y ** 2);
	if (distance <= Player.radius * 2) bounce(x, y, distance, p1, p2);
}

function bounce(x, y, distance, p1, p2) {
	const norm_x = x / distance, norm_y = y / distance;
	const speed = (p1.speed[0] - p2.speed[0]) * norm_x +
		(p1.speed[1] - p2.speed[1]) * norm_y;
	if (speed <= 0) return;
	const impulse = 2 * speed / (p1.mass + p2.mass);
	p1.speed[0] -= impulse * p2.mass * norm_x;
	p1.speed[1] -= impulse * p2.mass * norm_y;
	p2.speed[0] += impulse * p1.mass * norm_x;
	p2.speed[1] += impulse * p1.mass * norm_y;
}

function random_array_elem(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

class World {
	constructor(walls, spawn, treasures = [], teams, goals) {
		this.walls = walls;
		this.spawn = spawn;
		this.treasures = treasures;
		this.teams = teams;
		this.goals = goals;
	}
}

const public_terrains = [
	new World([
		[ 55, 45, 305, 1 ],   [ 650, 260, 5, 1 ],   [ 125, 260, 525, 1 ],
		[ 530, 65, 1, 135 ],  [ 690, 125, 230, 1 ], [ 745, 145, 1, 410 ],
		[ 240, 295, 465, 1 ], [ 390, 335, 1, 155 ], [ 490, 395, 155, 1 ],
		[ 125, 380, 1, 175 ], [ 485, 470, 185, 1 ], [ 90, 125, 320, 1 ],
		[ 450, 45, 1, 135 ],  [ 240, 155, 1, 70 ],  [ 785, 0, 1, 105 ],
		[ 610, 40, 1, 130 ],  [ 790, 235, 70, 1 ],  [ 885, 285, 1, 140 ],
		[ 780, 360, 40, 1 ],  [ 825, 565, 150, 1 ], [ 740, 625, 145, 1 ],
		[ 150, 585, 220, 1 ], [ 240, 405, 1, 70 ],  [ 435, 415, 1, 310 ],
		[ 505, 445, 115, 1 ], [ 485, 425, 1, 60 ],  [ 700, 460, 1, 120 ],
		[ 30, 680, 120, 1 ],  [ 35, 295, 75, 1 ],   [ 25, 100, 1, 145 ],
		[ 15, 365, 1, 80 ],   [ 40, 555, 86, 1 ],   [ 305, 695, 1, 175 ],
		[ 0, 775, 125, 1 ],   [ 15, 845, 150, 1 ],  [ 1000, 0, 1, 995 ],
		[ 0, 0, 1000, 1 ],    [ 0, 0, 1, 1000 ],    [ 0, 1000, 1000, 1 ],
		[ 1000, 0, 1, 1001 ], [ 1000, 0, 1, 1000 ], [ 595, 720, 275, 1 ],
		[ 590, 550, 1, 60 ],  [ 455, 875, 440, 1 ], [ 765, 775, 1, 50 ],
		[ 455, 775, 110, 1 ], [ 240, 720, 40, 1 ],  [ 120, 920, 285, 1 ],
		[ 115, 905, 275, 1 ], [ 215, 735, 1, 145 ], [ 195, 735, 1, 165 ],
		[ 195, 900, 1, 0 ],   [ 195, 900, 1, 5 ],   [ 485, 770, 1, 45 ],
		[ 470, 645, 270, 1 ], [ 535, 535, 1, 35 ],  [ 825, 455, 1, 110 ],
		[ 920, 195, 1, 125 ], [ 790, 430, 1, 90 ],  [ 920, 195, 1, 125 ],
		[ 650, 775, 235, 1 ], [ 815, 815, 1, 60 ],  [ 940, 715, 1, 195 ],
		[ 940, 350, 1, 140 ], [ 890, 530, 90, 1 ],  [ 965, 565, 1, 410 ],
		[ 915, 160, 55, 1 ],  [ 970, 30, 1, 155 ]
	], [[12, 12, 30, 30]]),
	new World([
		[ 0, 0, 1000, 1],     [ 0, 0, 1, 1000 ],
		[ 0, 1000, 1000, 1],  [ 1000, 0, 1, 1000 ],
		[ 80, 80, 1, 660 ],   [ 120, 840, 220, 1 ],
		[ 420, 480, 1, 440 ], [ 340, 260, 260, 1 ],
		[ 760, 220, 1, 340 ], [ 40, 760, 120, 1 ],
		[ 200, 200, 1, 520 ], [ 460, 740, 320, 1 ],
		[ 520, 400, 1, 240 ], [ 600, 340, 1, 120 ],
		[ 620, 620, 240, 1 ], [ 200, 80, 240, 1 ],
		[ 460, 120, 340, 1 ], [ 900, 60, 1, 620 ],
		[ 240, 380, 100, 1 ], [ 580, 380, 1, 460 ],
		[ 280, 520, 220, 1 ], [ 140, 440, 80, 1 ],
		[ 720, 680, 1, 220 ], [ 840, 680, 1, 140 ],
		[ 800, 500, 200, 1 ], [ 140, 880, 1, 100 ],
		[ 0, 920, 120, 1 ],   [ 920, 780, 80, 1 ],
		[ 360, 0, 1, 20 ],    [ 0, 60, 1, 20 ],
		[ 100, 0, 1, 20 ],    [ 820, 0, 1, 60 ],
		[ 900, 100, 20, 1 ]
	], [[12, 12, 30, 30]])
];

const private_terrains = {
	soccer: new World([
		[ 408, 84, 1, 228 ],  [ 792, 84, 1, 228 ],  [ 132, 480, 144, 1 ],
		[ 924, 480, 144, 1 ], [ 228, 312, 1, 84 ],  [ 972, 312, 1, 84 ],
		[ 96, 156, 168, 1 ],  [ 936, 156, 168, 1 ], [ 144, 36, 96, 1 ],
		[ 960, 36, 96, 1 ],   [ 300, 72, 1, 120 ],  [ 900, 72, 1, 120 ],
		[ 324, 384, 156, 1 ], [ 720, 384, 156, 1 ], [ 72, 228, 168, 1 ],
		[ 960, 228, 168, 1 ], [ 24, 348, 48, 1 ],   [ 1128, 348, 48, 1 ],
		[ 60, 264, 1, 84 ],   [ 1140, 264, 1, 84 ], [ 108, 348, 204, 1 ],
		[ 888, 348, 204, 1 ], [ 36, 24, 1, 36 ],    [ 1164, 24, 1, 36 ],
		[ 360, 420, 1, 132 ], [ 840, 420, 1, 132 ], [ 420, 540, 120, 1 ],
		[ 660, 540, 120, 1 ], [ 432, 420, 1, 72 ],  [ 768, 420, 1, 72 ],
		[ 540, 384, 1, 96 ],  [ 660, 384, 1, 96 ],  [ 468, 288, 84, 1 ],
		[ 648, 288, 84, 1 ],  [ 432, 192, 36, 1 ],  [ 732, 192, 36, 1 ],
		[ 480, 24, 1, 84 ],   [ 720, 24, 1, 84 ],   [ 516, 84, 1, 84 ],
		[ 684, 84, 1, 84 ],   [ 24, 408, 96, 1 ],   [ 1080, 408, 96, 1 ],
		[ 36, 528, 84, 1 ],   [ 1080, 528, 84, 1 ], [ 48, 432, 1, 60 ],
		[ 1152, 432, 1, 60 ], [ 228, 516, 1, 48 ],  [ 972, 516, 1, 48 ],
		[ 84, 48, 1, 84 ],    [ 1116, 48, 1, 84 ],  [ 264, 264, 72, 1 ],
		[ 864, 264, 72, 1 ],  [ 336, 0, 1, 72 ],    [ 864, 0, 1, 72 ],
		[ 108, 528, 1, 60 ],  [ 1092, 528, 1, 60 ], [ 108, 576, 216, 1 ],
		[ 876, 576, 216, 1 ], [ 300, 480, 1, 120 ], [ 900, 480, 1, 120 ],
		[ 12, 96, 72, 1 ],    [ 1116, 96, 72, 1 ],  [ 0, 0, 1200, 1 ],
		[ 0, 0, 1, 600 ],     [ 1200, 0, 1, 600 ],  [ 0, 600, 1201, 1 ]
	], [[[10, 290, 20, 20]], [[1170, 290, 20, 20]]],
	[[600 - Treasure.length / 2, 300 - Treasure.length / 2]],
	['#ff0000', '#0000ff'],
	[[[1170, 290, 20, 20]], [[10, 290, 20, 20]]])
};