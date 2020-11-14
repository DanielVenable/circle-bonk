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

	constructor(ws, username, is_public, world = public_terrain) {
		this.world = world;
		this.is_public = is_public;
		this.ticker = setInterval(this.tick.bind(this), Game.tick_length);

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
		const t_arr = [...this.treasures]
		for (let i = 0; i < t_arr.length; i++) {
			const treasure = t_arr[i];
			add(treasure.position, treasure.speed);
			treasure.speed[0] *= Game.friction;
			treasure.speed[1] *= Game.friction;
			treasure.bounce_off_walls();
			if (this.world.teams) {
				let scored = false;
				for (let i = 0; i < this.world.goals.length; i++) {
					for (const [x, y, width, height] of this.world.goals[i]) {
						if (overlap(x, y, width, height, ...treasure)) {
							this.scores[i]++;
							scored = true;
						}
					}
				}
				if (scored) {
					treasure.position = [...this.world.treasures[
						this.treasures.indexOf(treasure)]];
					treasure.speed = [0, 0];
					const message = JSON.stringify({
						type: 'score',
						message: this.scores
					});
					for (const { ws } of this.players) {
						ws.send(message);
					}
				}
			}
			for (let j = i + 1; j < t_arr.length; j++) {
				if (overlap(...treasure, ...t_arr[j])) {
					bounce(treasure, t_arr[j],
						t_arr[j].position[0] - treasure.position[0],
						t_arr[j].position[1] - treasure.position[1]);
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
			type: 'start',
			message: game.world.walls,
			id: this.id
		}));

		if (game.world.teams) {
			ws.send(JSON.stringify({
				type: 'goal',
				color: game.world.teams,
				message: game.world.goals
			}));
			ws.send(JSON.stringify({
				type: 'score',
				message: game.scores
			}));
		}
	}

	is_overlapping_wall() {
		for (const wall of this.game.world.walls) {
			if (circle_touches_rect(...this.position, Player.radius, ...wall)) {
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
		if (circle_touches_rect(...player.position, Player.radius, ...this)) {
			const x = player.position[0] - this.position[0] - Treasure.length / 2,
				y = player.position[1] - this.position[1] - Treasure.length / 2;
			bounce(this, player, x, y);
		}
	}

	*[Symbol.iterator]() {
		yield* this.position;
		yield Treasure.length;
		yield Treasure.length;
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

function overlap(x1, y1, width1, height1, x2, y2, width2, height2) {
	return overlap1d(x1, width1, x2, width2) &&
		overlap1d(y1, height1, y2, height2);
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
				const world = mode === 'normal' ?
					public_terrain : private_terrains.get(mode);
				if (world) {
					const game = new Game(ws, username, false, world);
					private_games.set(id, game);
					keys.set(game, id);
				} else ws.close();
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
	if (distance <= Player.radius * 2) bounce(p1, p2, x, y, distance);
}

function bounce(p1, p2, x, y, distance = Math.sqrt(x ** 2 + y ** 2)) {
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

const public_terrain = new World([
	[ 40, 20, 1, 60 ],    [ 120, 40, 60, 1 ],  [ 140, 100, 1, 80 ],
	[ 340, 120, 120, 1 ], [ 260, 180, 80, 1 ], [ 240, 220, 1, 80 ],
	[ 80, 300, 1, 80 ],   [ 400, 260, 40, 1 ], [ 80, 240, 60, 1 ],
	[ 320, 320, 100, 1 ], [ 560, 80, 1, 140 ], [ 400, 40, 60, 1 ],
	[ 260, 60, 1, 60 ],   [ 700, 80, 40, 1 ],  [ 620, 40, 1, 80 ],
	[ 200, 380, 1, 20 ],  [ 160, 300, 1, 40 ], [ 120, 340, 20, 1 ],
	[ 80, 440, 60, 1 ],   [ 320, 380, 80, 1 ], [ 520, 320, 1, 100 ],
	[ 620, 260, 1, 40 ],  [ 600, 360, 20, 1 ], [ 700, 140, 1, 60 ],
	[ 680, 260, 40, 1 ],  [ 40, 140, 40, 1 ],  [ 20, 220, 1, 80 ],
	[ 20, 440, 20, 1 ],   [ 260, 440, 60, 1 ], [ 480, 160, 1, 40 ],
	[ 320, 220, 1, 40 ],  [ 400, 440, 40, 1 ], [ 620, 420, 80, 1 ],
	[ 660, 320, 1, 60 ],  [ 520, 260, 40, 1 ], [ 440, 340, 1, 20 ],
	[ 460, 380, 40, 1 ],  [ 500, 20, 1, 40 ],  [ 320, 0, 1, 40 ],
	[ 700, 20, 100, 1 ],  [ 180, 460, 1, 40 ], [ 60, 480, 60, 1 ],
	[ 0, 500, 80, 1 ],    [ 560, 460, 1, 40 ], [ 360, 480, 1, 40 ],
	[ 240, 500, 1, 100 ], [ 80, 560, 40, 1 ],  [ 320, 560, 60, 1 ],
	[ 400, 880, 100, 1 ], [ 680, 480, 60, 1 ], [ 740, 400, 1, 20 ],
	[ 740, 320, 80, 1 ],  [ 780, 160, 1, 40 ], [ 780, 240, 40, 1 ],
	[ 800, 80, 40, 1 ],   [ 900, 20, 1, 20 ],  [ 940, 80, 1, 60 ],
	[ 880, 120, 1, 80 ],  [ 900, 260, 20, 1 ], [ 940, 200, 40, 1 ],
	[ 980, 260, 1, 40 ],  [ 880, 320, 40, 1 ], [ 820, 360, 40, 1 ],
	[ 940, 360, 40, 1 ],  [ 940, 400, 1, 40 ], [ 880, 400, 1, 40 ],
	[ 820, 400, 1, 40 ],  [ 820, 500, 20, 1 ], [ 900, 460, 60, 1 ],
	[ 900, 520, 80, 1 ],  [ 780, 520, 1, 40 ], [ 680, 520, 1, 60 ],
	[ 620, 520, 1, 40 ],  [ 500, 560, 40, 1 ], [ 420, 600, 100, 1 ],
	[ 760, 620, 1, 80 ],  [ 640, 620, 40, 1 ], [ 620, 680, 20, 1 ],
	[ 720, 660, 1, 40 ],  [ 520, 620, 60, 1 ], [ 500, 680, 40, 1 ],
	[ 400, 660, 1, 20 ],  [ 320, 620, 1, 40 ], [ 160, 560, 1, 60 ],
	[ 40, 540, 1, 40 ],   [ 40, 640, 20, 1 ],  [ 220, 660, 60, 1 ],
	[ 140, 660, 40, 1 ],  [ 100, 660, 1, 60 ], [ 20, 680, 20, 1 ],
	[ 40, 740, 60, 1 ],   [ 180, 680, 1, 60 ], [ 280, 720, 40, 1 ],
	[ 220, 780, 1, 40 ],  [ 100, 800, 40, 1 ], [ 420, 760, 100, 1 ],
	[ 860, 600, 1, 80 ],  [ 960, 800, 1, 40 ], [ 800, 740, 60, 1 ],
	[ 780, 820, 80, 1 ],  [ 720, 740, 1, 40 ], [ 620, 740, 1, 80 ],
	[ 560, 820, 1, 80 ],  [ 460, 820, 1, 20 ], [ 0, 940, 40, 1 ],
	[ 340, 800, 20, 1 ],  [ 340, 740, 40, 1 ], [ 660, 960, 80, 1 ],
	[ 300, 820, 1, 40 ],  [ 160, 860, 1, 40 ], [ 800, 860, 1, 60 ],
	[ 40, 780, 1, 60 ],   [ 100, 840, 40, 1 ], [ 600, 160, 1, 40 ],
	[ 40, 880, 40, 1 ],   [ 260, 920, 60, 1 ], [ 840, 940, 1, 60 ],
	[ 240, 860, 1, 20 ],  [ 60, 920, 80, 1 ],  [ 900, 640, 40, 1 ],
	[ 940, 700, 40, 1 ],  [ 900, 780, 1, 40 ], [ 900, 580, 80, 1 ],
	[ 780, 780, 40, 1 ],  [ 900, 900, 80, 1 ], [ 900, 960, 80, 1 ],  
	[ 600, 920, 1, 80 ],  [ 480, 940, 40, 1 ], [ 640, 860, 100, 1 ],
	[ 340, 960, 1, 40 ],  [ 380, 900, 1, 20 ], [ 140, 960, 1, 40 ],  
	[ 20, 980, 40, 1 ],   [ 700, 900, 40, 1 ], [ 800, 600, 20, 1 ],  
	[ 400, 180, 1, 20 ],  [ 180, 120, 1, 60 ], [ 240, 360, 40, 1 ],
	[ 360, 40, 1, 20 ],   [ 0, 0, 1000, 1 ],   [ 0, 0, 1, 1000 ],
	[ 1000, 0, 1, 1000 ], [ 0, 1000, 1001, 1 ]
], [[ 450.5, 450.5, 100, 100 ]]);

const private_terrains = new Map([
	['hard', new World([
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
	],
		[[[10.5, 290.5, 20, 20]], [[1170.5, 290.5, 20, 20]]],
		[[600.5 - Treasure.length / 2, 300.5 - Treasure.length / 2]],
		['#ff0000', '#0000ff'],
		[[[1170.5, 290.5, 20, 20]], [[10.5, 290.5, 20, 20]]]
	)],
	['4-square', new World([
		[ 0, 0, 360, 1 ],    [ 0, 0, 1, 360 ],
		[ 360, 0, 1, 361 ],  [ 0, 360, 360, 1],
		[ 100, 100, 1, 30 ], [ 230, 100, 30, 1 ],
		[ 100, 260, 30, 1 ], [ 260, 230, 1, 30 ],
	],
		Array(4).fill([[ 10.5, 10.5, 340, 340 ]]),
		[[180.5 - Treasure.length / 2, 180.5 - Treasure.length / 2]],
		['hsl(0, 100%, 50%)', 'hsl(90, 100%, 30%)',
			'hsl(180, 100%, 40%)', 'hsl(270, 100%, 50%'],
		[[[ 2, 1, 357, 1 ]], [[ 359, 2, 1, 357 ]],
			[[ 2, 359, 357, 1]], [[ 1, 2, 1, 357 ]]]
	)],
	['many-treasures', new World([
		[ 0, 0, 400, 1 ], [ 400, 0, 1, 340 ],  [ 0, 340, 401, 1 ],
		[ 0, 0, 1, 340 ], [ 100, 40, 1, 260 ], [ 300, 40, 1, 260 ]
	],
		Array(2).fill([[ 180, 150, 20, 20 ]]),
	[
		[150.5 - Treasure.length / 2, 70.5 - Treasure.length / 2],
		[200.5 - Treasure.length / 2, 70.5 - Treasure.length / 2],
		[250.5 - Treasure.length / 2, 70.5 - Treasure.length / 2],
		[150.5 - Treasure.length / 2, 120.5 - Treasure.length / 2],
		[200.5 - Treasure.length / 2, 120.5 - Treasure.length / 2],
		[250.5 - Treasure.length / 2, 120.5 - Treasure.length / 2],
		[150.5 - Treasure.length / 2, 170.5 - Treasure.length / 2],
		[200.5 - Treasure.length / 2, 170.5 - Treasure.length / 2],
		[250.5 - Treasure.length / 2, 170.5 - Treasure.length / 2],
		[150.5 - Treasure.length / 2, 220.5 - Treasure.length / 2],
		[200.5 - Treasure.length / 2, 220.5 - Treasure.length / 2],
		[250.5 - Treasure.length / 2, 220.5 - Treasure.length / 2],
		[150.5 - Treasure.length / 2, 270.5 - Treasure.length / 2],
		[200.5 - Treasure.length / 2, 270.5 - Treasure.length / 2],
		[250.5 - Treasure.length / 2, 270.5 - Treasure.length / 2],
	],
		['#ff0000', '#0000ff'],
		[[[ 45.5, 165.5, 10, 10 ]], [[ 345.5, 165.5, 10, 10 ]]]
	)],
	['enclosed', new World([
		[ 20, 20, 320, 1 ],   [ 20, 20, 1, 260 ],  [ 0, 300, 441, 1 ],
		[ 440, 0, 1, 300 ],   [ 40, 280, 380, 1 ], [ 240, 80, 1, 200 ],
		[ 120, 100, 120, 1 ], [ 120, 180, 60, 1 ], [ 120, 100, 1, 140 ],
		[ 20, 260, 180, 1 ],  [ 160, 140, 40, 1 ], [ 200, 120, 1, 141 ],
		[ 160, 200, 40, 1 ],  [ 120, 240, 60, 1 ], [ 60, 60, 1, 180 ],
		[ 60, 60, 180, 1 ],   [ 280, 20, 1, 240 ], [ 320, 260, 120, 1 ],
		[ 320, 60, 1, 200 ],  [ 360, 0, 1, 220 ],  [ 400, 20, 1, 240 ],
		[ 0, 0, 440, 1 ],     [ 0, 0, 1, 300 ]
	], [[ 405.5, 150.5, 30, 100 ]])]
]);