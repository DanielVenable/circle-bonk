import { publicTerrain } from './worlds.js';

const CIRCLE_RADIUS = 5;
const CIRCLE_ACCEL = 0.3;
const CIRCLE_MASS = 1;
const TREASURE_LENGTH = 10;
const TREASURE_MASS = 0.5;

export class Game {
    id = 0;
    /** @type {Set<Player>} */
    players = new Set();
    /** @type {Set<Player>} */
    dead = new Set();
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
                const bot = new Bot(this);
                bot.init();
                this.bots.push(bot);
            }
        }
        new Player(ws, this, username).init();

        ws.on('close', () => {
            if (this.players.size === 0) {
                this.destroy();
            }
        });
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
        /** @type {[Number, Player | Bot | Treasure, Boolean][]} */
        let hitList = [];

        for (const circle of this.circles()) {
            circle.move();
        }

        // Apply friction and find wall hits for all mobiles
        for (const mobile of this.mobiles()) {
            mobile.speed[0] *= Game.friction;
            mobile.speed[1] *= Game.friction;
            this.findWallHit(mobile, hitList);
        }

        const dead = [];
        const deadBots = [];

        while (hitList.length) {
            hitList.sort(([a], [b]) => b - a);
            const [time, mobile, isHorizontal] = hitList.pop();
            hitList = hitList.filter(([, p, q]) => !([mobile, isHorizontal].includes(p) || [mobile, isHorizontal].includes(q)));
            for (let i = 0; i < 2; i++) {
                mobile.position[i] += mobile.speed[i] * time;
            }
            if (mobile instanceof Player) {
                dead.push(mobile);
                this.players.delete(mobile);
            } else if (mobile instanceof Bot) {
                deadBots.push(mobile);
                mobile.restart();
            } else if (mobile instanceof Treasure) {
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
                        if (overlap(x, y, width, height, ...treasure.position, TREASURE_LENGTH, TREASURE_LENGTH)) {
                            this.scores[i]++;
                            scored = true;
                        }
                    }
                }
                if (scored) {
                    treasure.position = [...this.world.treasures[this.treasures.indexOf(treasure)]];
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

        const mobiles = this.mobiles();
        for (let i = 0; i < mobiles.length; i++) {
            for (let j = i + 1; j < mobiles.length; j++) {
                collide(mobiles[i], mobiles[j]);
            }
        }

        const circles = this.circles();
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
            for (const isHorizontal of [true, false]) {
                const hit = mobile.hitLine(wall, isHorizontal);
                if (hit !== undefined && hit < minTime) {
                    minTime = hit;
                    minIsHorizontal = isHorizontal;
                }
            }
        }
        if (minIsHorizontal !== undefined) {
            hitList.push([minTime, mobile, minIsHorizontal]);
        }
    }

    remove(player) {
        this.players.delete(player);
        this.dead.delete(player);
        this.sendToAll('bye', player);
        if (this.allPlayers().length === 0) this.destroy();
    }

    allPlayers() {
        return [...this.players, ...this.dead];
    }

    mobiles() {
        return [...this.circles(), ...this.treasures];
    }

    circles() {
        return [...this.players, ...this.bots];
    }

    getColor() {
        if (this.world.teams) {
            const teamNumbers = new Map();
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

    getPosition(color) {
        if (this.world.teams) {
            return randomPosition(this.world.spawn[this.world.teams.indexOf(color)]);
        } else {
            let pos;
            do {
                pos = randomPosition(this.world.spawn);
            } while (!this.world.walls.every(wall => !circleTouchesRect(...pos, CIRCLE_RADIUS, ...wall)));
            return pos;
        }
    }

    static maxPlayers = 20;
    static tickLength = 50;
    static friction = 0.95;
}

export class Player {
    speed = [0, 0];
    accel = [0, 0];
    timeLeft = 1;
    mass = CIRCLE_MASS;
    radius = CIRCLE_RADIUS;
    shape = 'circle';

    constructor(ws, game, username) {
        this.game = game;
        this.ws = ws;
        this.username = username;
        this.color = game.getColor();
        this.position = game.getPosition(this.color);
        this.id = game.id++;
    }

    move() {
        this.speed[0] += this.accel[0];
        this.speed[1] += this.accel[1];
    }

    restart() {
        this.position = this.game.getPosition(this.color);
        this.speed = [0, 0];
    }

    hitLine(wall, isHorizontal) {
        return circleHitLine(this, wall, isHorizontal);
    }

    init() {
        this.start();

        this.ws.on('message', data => {
            try {
                data = JSON.parse(data);
            } catch {
                return;
            }
            if (data.type === 'message' && !this.game.isPublic) {
                this.game.sendToAll('message', this, false, false, String(data.message));
            } else if (data.type === 'position') {
                const norm = Math.hypot(data.x, data.y);
                if (isNaN(norm)) return;
                this.accel = [
                    data.x * CIRCLE_ACCEL / norm || 0,
                    data.y * CIRCLE_ACCEL / norm || 0
                ];
            } else if (data.type === 'restart') {
                this.username = String(data.username);
                this.game.dead.delete(this);
                this.start();
                if (!this.game.world.teams) this.color = randomColor();
                this.restart();
            }
        });

        this.ws.on('close', () => this.game.remove(this));

        this.ws.send(JSON.stringify({
            type: 'start',
            message: this.game.world.walls,
            id: this.id
        }));

        if (this.game.world.teams) {
            this.ws.send(JSON.stringify({
                type: 'goal',
                color: this.game.world.teams,
                message: this.game.world.goals
            }));
            this.ws.send(JSON.stringify({
                type: 'score',
                message: this.game.scores
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
            ...mobile.boundingRect());
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
        };
        if (sendPos) obj.pos = this.position;
        this.ws.send(JSON.stringify(obj));
    }

    boundingRect() {
        return [
            this.position[0] - this.radius,
            this.position[1] - this.radius,
            this.radius * 2,
            this.radius * 2];
    }

    static maxNameLength = 30;
    static boardWidth = 300;
    static boardHeight = 200;
}

export class Treasure {
    speed = [0, 0];
    timeLeft = 1;
    mass = TREASURE_MASS;
    length = TREASURE_LENGTH;
    shape = 'square';

    constructor(game, x = 0, y = 0) {
        this.game = game;
        this.position = [x, y];
    }

    bounceOffCircle(circle) {
        if (circleTouchesRect(
                ...circle.position, CIRCLE_RADIUS,
                ...this.boundingRect())) {
            bounce(circle, this,
                this.position[0] - circle.position[0] + this.length / 2,
                this.position[1] - circle.position[1] + this.length / 2);
        }
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
            edge = this.position[i] + this.length;

            if (edge + this.speed[i] * this.timeLeft < x || edge > x) {
                canHitSide = false;
            }
        } else {
            edge = this.position[i];
            x += w;
            if (edge + this.speed[i] * this.timeLeft > x || edge < x) {
                canHitSide = false;
            }
        }

        const ans = (x - edge) / this.speed[i];
        const newY = this.position[1-i] + this.speed[1-i] * ans;
        if (newY <= y + h && newY + this.length / 2 >= y && canHitSide) {
            return ans;
        }
    }

	boundingRect() {
        return [...this.position, this.length, this.length];
	}
}

export class Bot {
    speed = [0, 0];
    accel = [0, 0];
    timeLeft = 1;
    mass = CIRCLE_MASS;
    radius = CIRCLE_RADIUS;
    color = 0x666666;
    shape = 'circle';

    constructor(game) {
        this.game = game;
        this.position = game.getPosition(this.color);
        this.id = game.id++;
    }

    move() {
        this.speed[0] += this.accel[0];
        this.speed[1] += this.accel[1];
    }

    restart() {
        this.position = this.game.getPosition(this.color);
        this.speed = [0, 0];
    }

    hitLine(wall, isHorizontal) {
        return circleHitLine(this, wall, isHorizontal);
    }

    init() {
        setInterval(this.think.bind(this), Bot.thinkTime);
    }

    think() {
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
            this.accel = potentialDiff.map(diff => CIRCLE_ACCEL * diff / potentialHypot);
        } else {
            const hits = [false, false, false, false];
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
            if (hits[0]) { accel[0]--; accel[1]--; }
            if (hits[1]) { accel[0]++; accel[1]--; }
            if (hits[2]) { accel[0]--; accel[1]++; }
            if (hits[3]) { accel[0]++; accel[1]--; }

            if (hits.includes(true)) {
                const hypot = Math.hypot(...accel);
                this.accel = hypot === 0 ? [0, 0] : accel.map(a => a / hypot);
            } else {
                const angle = Math.random() * Math.PI * 2;
                this.accel = [Math.cos(angle), Math.sin(angle)];
            }
        }
    }

    boundingRect() {
        return [
            this.position[0] - this.radius,
            this.position[1] - this.radius,
            this.radius * 2,
            this.radius * 2];
    }

    static thinkTime = 20;
}

function circleHitLine(circle, [ x, y, w, h ], isHorizontal) {
    const i = +isHorizontal;

    if (circle.speed[i] === 0) return;

    if (isHorizontal) {
        [x, y] = [y, x];
        [h, w] = [w, h];
    }

    let edge, canHitSide = true;
    if (circle.speed[i] > 0) {
        edge = circle.position[i] + circle.radius;

        if (edge + circle.speed[i] * circle.timeLeft < x || edge > x) {
            canHitSide = false;
        }
    } else {
        edge = circle.position[i] - circle.radius;
        x += w;
        if (edge + circle.speed[i] * circle.timeLeft > x || edge < x) {
            canHitSide = false;
        }
    }

    const ans = (x - edge) / circle.speed[i];
    const newY = circle.position[1-i] + circle.speed[1-i] * ans;
    if (newY <= y + h && newY >= y) return canHitSide ? ans : undefined;
    let py = y;
    let min;
    for (let isFirst = true; isFirst; isFirst = false) {
        const dist = Math.hypot(x - circle.position[i], py - circle.position[1-i]);
        const yDiff = py - circle.position[1-i];
        const xDiff = x - circle.position[i];
        const direction = Math.atan(circle.speed[1-i] / circle.speed[i]);
        const angle = direction - Math.atan(yDiff / xDiff);
        const altitude = Math.sin(angle) * dist;
        const inside = Math.sqrt(circle.radius ** 2 - altitude ** 2);
        const answer = (Math.cos(angle) * dist - inside) / Math.hypot(...circle.speed);
        if (answer <= circle.timeLeft && answer >= 0) {
            if (isFirst) min = answer;
            else min = Math.min(min, answer);
        }
    }
    return min;
}

function collide(m1, m2) {
    if (m1.shape === 'circle' && m2.shape === 'circle') {
        const x = m2.position[0] - m1.position[0];
        const y = m2.position[1] - m1.position[1];
        const dist = Math.hypot(x, y);
        if (dist <= CIRCLE_RADIUS * 2) bounce(m1, m2, x, y, dist);
    } else if (m1.shape === 'circle' && m2.shape === 'square') {
        m2.bounceOffCircle(m1);
    } else if (m1.shape === 'square' && m2.shape === 'circle') {
        m1.bounceOffCircle(m2);
    } else if (m1.shape === 'square' && m2.shape === 'square') {
        if (overlap(...m1.boundingRect(), ...m2.boundingRect())) {
            bounce(m1, m2, m2.position[0] - m1.position[0], m2.position[1] - m1.position[1]);
        }
    }
}

function randomPosition(rects) {
    const rect = randomArrayElem(rects);
    return [0, 1].map(n => rect[n] + Math.random() * rect[2 + n]);
}

function circleTouchesRect(x, y, r, x1, y1, width, height) {
    if (x + r > x1 && x - r < x1 + width && y + r > y1 && y - r < y1 + height) {
        let isBelow, isRight;
        return (isRight = x1 < x) && x < x1 + width ||
            (isBelow = y1 < y) && y < y1 + height ||
            (isRight ? x1 + width - x : x1 - x) ** 2 +
            (isBelow ? y1 + height - y : y1 - y) ** 2 < r ** 2;
    }
    return false;
}

function overlap(x1, y1, width1, height1, x2, y2, width2, height2) {
    return overlap1d(x1, width1, x2, width2) && overlap1d(y1, height1, y2, height2);
}

function overlap1d(x1, width1, x2, width2) {
    return x1 <= x2 && x2 < x1 + width1 || x2 <= x1 && x1 < x2 + width2;
}

export function randomColor() {
    return `hsl(${360 * Math.random()},100%,${Math.random() * 50 + 20}%)`;
}

function bounce(m1, m2, x, y, distance = Math.hypot(x, y)) {
    const normX = x / distance, normY = y / distance;
    const speed = (m1.speed[0] - m2.speed[0]) * normX + (m1.speed[1] - m2.speed[1]) * normY;
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