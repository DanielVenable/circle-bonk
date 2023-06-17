import { publicTerrain } from './worlds.js';

export class Game {
	id = 0;
	/** @type {Set<Player>} */
	players = new Set;
	/** @type {Set<Player>} */
	dead = new Set;
	/** @type {Bot[]} */
	bots = [];
	/** @type {Treasure[]} */
	treasures = [];

	constructor(ws, username, isPublic, world = publicTerrain) {
		this.world = world;
		this.isPublic = isPublic;
		this.ticker = setInterval(this.tick.bind(this), Game.tickLength);

		for (const treasure of this.world.treasures) {
			this.treasures.push(new Treasure(this, ...treasure));
		}

		if (this.world.teams) {
			this.scores = new Array(this.world.teams.length).fill(0);
		} else {
			for (let i = 1; i < Game.maxPlayers; i++) {
				this.bots.push(new Bot(this));
			}
		}
		new Player(ws, this, username);

		ws.on('close', () => {
			if (this.players.size === 0) {
				this.destroy();
			}
		})
	}

	sendToAll(type, from, sendToMe = false, sendUsername = false, message) {
		const obj = { type, id: from.id };
		if (message !== undefined) obj.message = message;
		if (sendUsername) {
			obj.name = from.username;
			obj.color = from.color;
		}
		const str = JSON.stringify(obj);
		for (const player of this.allPlayers()) {
			if (sendToMe || player !== from) player.ws.send(str);
		}
	}

	destroy() {
		clearInterval(this.ticker);
        if (Game.remove) {
            Game.remove(this);
        }
	}

	tick() {
		/** @type {[Number, Mobile, Boolean][]} */
		let hitList = [];

		for (const circle of this.circles()) {
			circle.move();
		}

		for (const mobile of this.mobiles()) {
			mobile.speed[0] *= Game.friction;
			mobile.speed[1] *= Game.friction;
			this.findWallHit(mobile, hitList);
		}

		const dead = [];
		const deadBots = [];

		while (hitList.length) {
			hitList.sort(([a], [b]) => b - a);
			const [ time, mobile, isHorizontal ] = hitList.pop();
				hitList = hitList.filter(([, p, q]) =>
					!([mobile, isHorizontal].includes(p) || [mobile, isHorizontal].includes(q)));
			for (let i = 0; i < 2; i++) {
				mobile.position[i] += mobile.speed[i] * time;
			}
			if (mobile instanceof Player) {
				dead.push(mobile);
				this.players.delete(mobile);
			} else if (mobile instanceof Bot) {
				deadBots.push(mobile);
				mobile.restart();
			} else {
				mobile.timeLeft = 1 - time;
				mobile.speed[+isHorizontal] *= -1;
				this.findWallHit(mobile, hitList);
			}
		}

		for (const mobile of this.mobiles()) {
			mobile.position[0] += mobile.speed[0] * mobile.timeLeft;
			mobile.position[1] += mobile.speed[1] * mobile.timeLeft;
			mobile.timeLeft = 1;
		}

		if (this.world.teams) {
			for (let i = 0; i < this.treasures.length; i++) {
				const treasure = this.treasures[i];
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
					for (const { ws } of this.allPlayers()) {
						ws.send(message);
					}
					return;
				}
			}
		}

		const mobiles = [...this.mobiles()];
		for (let i = 0; i < mobiles.length; i++) {
			for (let j = i + 1; j < mobiles.length; j++) {
				collide(mobiles[i], mobiles[j]);
			}
		}

		const circles = [...this.circles()];
		for (const player of this.players) {
			player.sendData(circles, true);
		}

		for (const player of this.dead) {
			player.sendData(circles, false);
		}

		for (const player of dead) {
			this.dead.add(player);
			player.sendData(circles, true);
			this.sendToAll('die', player, true);
		}
	}

	findWallHit(mobile, hitList) {
		let minTime = Infinity, minIsHorizontal;
		for (const wall of this.world.walls) {
			for (const isHorizontal of [ true, false ]) {
				const hit = mobile.hitLine(wall, isHorizontal);
				if (hit < minTime) {
					minTime = hit;
					minIsHorizontal = isHorizontal;
				}
			}
		}
		if (minIsHorizontal !== undefined) {
			hitList.push([ minTime, mobile, minIsHorizontal ]);
		}
	}

	remove(player) {
		this.players.delete(player);
		this.dead.delete(player);
		this.sendToAll('bye', player);
		if (this.allPlayers().next().done) this.destroy();
	}

	*allPlayers() {
		yield* this.players;
		yield* this.dead;
	}

	*mobiles() {
		yield* this.circles();
		yield* this.treasures;
	}

	*circles() {
		yield* this.players;
		yield* this.bots;
	}

	getColor() {
		if (this.world.teams) {
			const teamNumbers = new Map;
			for (const color of this.world.teams) {
				teamNumbers.set(color, 0);
			}
			for (const { color } of this.allPlayers()) {
				teamNumbers.set(color, teamNumbers.get(color) + 1);
			}
			let leastNum = Infinity,
				leastValues = [];
			for (const [color, num] of teamNumbers) {
				if (num === leastNum) leastValues.push(color);
				else if (num < leastNum) {
					leastNum = num;
					leastValues = [color];
				}
			}
			return randomArrayElem(leastValues);
		} else return randomColor();
	}

	/**
	 * gets the spawn position for a circle
	 * @param {String} color the circle's color
	 * @returns {[Number]} the spawn position
	 */
	getPosition(color) {
		if (this.world.teams) {
			return randomPosition(
				this.world.spawn[this.world.teams.indexOf(color)]);
		} else {
			let pos;
			do {
				pos = randomPosition(this.world.spawn);
			} while (!this.world.walls.every(
				wall => !circleTouchesRect(...pos, Circle.radius, ...wall)));
			return pos;
		}
	}

	static maxPlayers = 20;
	static tickLength = 50;
	static friction = 0.95;
}

class Mobile {
	speed = [0, 0];
	timeLeft = 1;

	/** @param {Game} game */
	constructor(game, x = 0, y = 0) {
		this.position = [x, y];
		this.game = game;
	}

	hitLine([ x, y, w, h ], isHorizontal) {
		const i = +isHorizontal;

		if (this.speed[i] === 0) return;

		if (isHorizontal) {
			[x, y] = [y, x];
			[h, w] = [w, h];
		}

		let edge, canHitSide = true;
		if (this.speed[i] > 0) {
			edge = this.position[i] +
				(this instanceof Treasure ? Treasure.length : Circle.radius);
			if (edge + this.speed[i] * this.timeLeft < x || edge > x) {
				canHitSide = false;
			}
		} else {
			edge = this.position[i] -
				(this instanceof Treasure ? 0 : Circle.radius);
			x += w;
			if (edge + this.speed[i] * this.timeLeft > x || edge < x) {
				canHitSide = false;
			}
		}

		const ans = (x - edge) / this.speed[i];
		const newY = this.position[1-i] + this.speed[1-i] * ans;
		if (this instanceof Circle) {
			if (newY <= y + h && newY >= y) return canHitSide ? ans : undefined;
			let py = y;
			let min;
			for (let isFirst = true; isFirst; isFirst = false) {
				const dist = Math.hypot(x - this.position[i], py - this.position[1-i]);
				const yDiff = py - this.position[1-i];
				const xDiff = x - this.position[i];
				const direction = Math.atan(this.speed[1-i] / this.speed[i]);
				const angle = direction - Math.atan(yDiff / xDiff);
				const altitude = Math.sin(angle) * dist;
				const inside = Math.sqrt(Circle.radius ** 2 - altitude ** 2);
				const answer = (Math.cos(angle) * dist - inside) / Math.hypot(...this.speed);
				if (answer <= this.timeLeft && answer >= 0) {
					if (isFirst) min = answer;
					else min = Math.min(min, answer);
				}
			}
			return min;
		} else if (newY <= y + h && newY + Treasure.length / 2 >= y && canHitSide) {
			return ans;
		}
	}
}

class Circle extends Mobile {
	accel = [0, 0];

	constructor(game) {
		const color = game.getColor();
		super(game, ...game.getPosition(color));
		this.color = color;
		this.id = game.id++;
	}

	move() {
		this.speed[0] += this.accel[0];
		this.speed[1] += this.accel[1];
	}

	/** resets position and speed */
	restart() {
		this.position = this.game.getPosition(this.color);
		this.speed = [0, 0];
	}

	static radius = 5;
	static accel = 0.3;
}
Circle.prototype.mass = 1;

export class Player extends Circle {
	constructor(ws, game, username) {
		super(game);
		this.username = username;
		this.ws = ws;
		this.start();

		ws.on('message', data => {
			try {
				data = JSON.parse(data);
			} catch {
				return;
			}
			if (data.type === 'message' && !game.isPublic) {
				game.sendToAll('message', this, false, false, String(data.message));
			} else if (data.type === 'position') {
				const norm = Math.hypot(data.x, data.y);
				if (isNaN(norm)) return;
				this.accel = [
					data.x * Circle.accel / norm || 0,
					data.y * Circle.accel / norm || 0];
			} else if (data.type === 'restart') {
				this.username = String(data.username);
				game.dead.delete(this);
				this.start();
				if (!game.world.teams) this.color = randomColor();
				this.restart();
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

		this.game.sendToAll('player', this, false, true);
	}
	
	isOnScreen(mobile) {
		return overlap(
			this.position[0] - Player.boardWidth / 2,
			this.position[1] - Player.boardHeight / 2,
			Player.boardWidth, Player.boardHeight,
			...(mobile instanceof Treasure ? mobile : [
				mobile.position[0] - Circle.radius,
				mobile.position[1] - Circle.radius,
				Circle.radius * 2,
				Circle.radius * 2
			]));
	}

	sendData(players, sendPos) {
		const obj = {
			type: 'position',
			treasures: this.game.treasures
				.filter(t => this.isOnScreen(t))
				.map(({ position }) => position),
			message: players
				.filter(p => this !== p && this.isOnScreen(p))
				.map(({ id, position }) => [id, position])
		}
		if (sendPos) obj.pos = this.position;
		this.ws.send(JSON.stringify(obj));
	}

	static maxNameLength = 30;
	static boardWidth = 300;
	static boardHeight = 200;
}

export class Treasure extends Mobile {
	bounceOffCircle(circle) {
		if (circleTouchesRect(...circle.position, Circle.radius, ...this)) {
			bounce(circle, this,
				this.position[0] - circle.position[0] + Treasure.length / 2,
				this.position[1] - circle.position[1] + Treasure.length / 2);
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

export class Bot extends Circle {
	color = 0x666666;

	constructor(game) {
		super(game, ...game.getPosition());
		setInterval(this.think.bind(this), Bot.thinkTime);
	}

	/** decides how to move */
	think() {
		// chase any players found
		let potentialHypot = 100;
		let potentialDiff = [0, 0];
		let foundPlayer = false;
		for (const player of this.game.players) {
			const xDiff = player.position[0] - this.position[0];
			const yDiff = player.position[1] - this.position[1];
			const hypot = Math.hypot(xDiff, yDiff);
			if (hypot < potentialHypot) {
				potentialHypot = hypot;
				potentialDiff = [xDiff, yDiff];
				foundPlayer = true;
			}
		}

		if (foundPlayer) {
			this.accel = potentialDiff.map(diff => Circle.accel * diff / potentialHypot);
		} else {
			// if no player is found, avoid walls
			const hits = [
				false, false,
				false, false
			];
			const visionRadius = 30;
			const hitRects = [
				[this.position[0] - visionRadius, this.position[1] - visionRadius, visionRadius, visionRadius],
				[this.position[0], this.position[1] - visionRadius, visionRadius, visionRadius],
				[this.position[0] - visionRadius, this.position[1], visionRadius, visionRadius],
				[this.position[0], this.position[1], visionRadius, visionRadius],
			];

			for (const wall of this.game.world.walls) {
				for (let i = 0; i < 4; i++) {
					if (!hits[i] && overlap(...wall, ...hitRects[i])) {
						hits[i] = true;
					}
				}
			}

			const accel = [0, 0];

			if (hits[0]) {
				accel[0]--;
				accel[1]--;
			}
			if (hits[1] || hits[3]) {
				accel[0]++;
				accel[1]--;
			}
			if (hits[2]) {
				accel[0]--;
				accel[1]++;
			}
			if (hits[3]) {
				accel[0]++
				accel[1]--;
			}

			if (hits.includes(true)) {
				const hypot = Math.hypot(...accel);
				this.accel = hypot === 0 ? [0, 0] : accel.map(a => a / hypot);
			} else {
				// move in a random direction
				const angle = Math.random() * Math.PI * 2;
				this.accel = [Math.cos(angle), Math.sin(angle)];
			}
		}
	}

	static thinkTime = 20;
}

function randomPosition(rects) {
	const rect = randomArrayElem(rects);
	return [0, 1].map(n => rect[n] + Math.random() * rect[2 + n]);
}

function circleTouchesRect(x, y, r, x1, y1, width, height) {
	if (x + r > x1 && x - r < x1 + width &&
		y + r > y1 && y - r < y1 + height) {
		let isBelow, isRight;
		return (isRight = x1 < x) && x < x1 + width ||
			(isBelow = y1 < y) && y < y1 + height ||
			(isRight ? x1 + width - x : x1 - x) ** 2 +
			(isBelow ? y1 + height - y : y1 - y) ** 2 < r ** 2;
	}
}

function overlap(x1, y1, width1, height1, x2, y2, width2, height2) {
	return overlap1d(x1, width1, x2, width2) &&
		overlap1d(y1, height1, y2, height2);
}

function overlap1d(x1, width1, x2, width2) {
	return x1 <= x2 && x2 < x1 + width1 || x2 <= x1 && x1 < x2 + width2;
}

export function randomColor() {
	return `hsl(${360 * Math.random()},100%,${Math.random() * 50 + 20}%)`;
}

function collide(m1, m2) {
	if (m1 instanceof Circle) {
		if (m2 instanceof Circle) {
			const x = m2.position[0] - m1.position[0],
				y = m2.position[1] - m1.position[1],
				dist = Math.hypot(x, y);
			if (dist <= Circle.radius * 2) bounce(m1, m2, x, y, dist); 
		} else m2.bounceOffCircle(m1);
	} else {
		if (m2 instanceof Treasure) {
			if (overlap(...m1, ...m2)) {
				bounce(m1, m2, m2.position[0] - m1.position[0],
					m2.position[1] - m1.position[1]);
			}
		} else m1.bounceOffCircle(m2);
	}
}

function bounce(m1, m2, x, y, distance = Math.hypot(x, y)) {
	const normX = x / distance, normY = y / distance;
	const speed = (m1.speed[0] - m2.speed[0]) * normX +
		(m1.speed[1] - m2.speed[1]) * normY;
	if (speed <= 0) return;
	const impulse = 2 * speed / (m1.mass + m2.mass);
	m1.speed[0] -= impulse * m2.mass * normX;
	m1.speed[1] -= impulse * m2.mass * normY;
	m2.speed[0] += impulse * m1.mass * normX;
	m2.speed[1] += impulse * m1.mass * normY;
}

function randomArrayElem(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}
