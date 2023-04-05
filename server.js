import { format } from 'util';
import WebSocket from 'ws';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { parse } from 'url';
import { publicTerrain, privateTerrains } from './worlds.js';
import { sign, verify } from './code-generate.js';
import { Game, Player, randomColor } from './circle-bonk.js';

const port = +process.env.PORT || 3000;

process.chdir('./files');

const files = {
	game: readFile('game.html').then(String),
	home: readFile('home-page.html').then(String),
	favicon: readFile('favicon.svg').then(String),
	style: readFile('style.css').then(String),
	script: readFile('game.js').then(String),
	chatbox: readFile('chatbox.html').then(String),
	noExist: readFile('no-exist.html').then(String)
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
			return res.end(format(await files.home, randomColor()));
		case '/play':
			return res.end(format(await files.game, '', ''));
		case '/favicon.svg':
			res.setHeader('Content-Type', 'image/svg+xml');
			return res.end(format(await files.favicon, randomColor()));
		case '/style.css':
			res.setHeader('Content-Type', 'text/css');
			return res.end(await files.style);
		case '/game.js':
			res.setHeader('Content-Type', 'text/javascript');
			return res.end(await files.script);
		default:
			let regexp;
			if (regexp = req.url.match(/^\/code\/([\w\-]+)$/)) {
				res.setHeader('Content-Type', 'text/plain');
				return res.end(await sign(regexp[1]));
			} else if (regexp = req.url.match(/^\/play\/([\w\-]+)$/)) {
				return res.end(
					verify(regexp[1]) === undefined ?
						format(await files.noExist, regexp[1]) :
						format(await files.game, regexp[1], await files.chatbox));
			} else {
				res.statusCode = 404;
				return res.end();
			}
	}
});

const wsServer = new WebSocket.Server({ server });

server.listen(port, () =>
	console.log('Server running on port %d', port));

const privateGames = new Map, keys = new WeakMap, publicGames = new Set;

Game.remove = game => {
	publicGames.delete(game);
	privateGames.delete(keys.get(game));
};

wsServer.on('connection', (ws, req) => {
	let { username, id } = parse(req.url, true).query;
	username = String(username);
	if (username.length > Player.maxNameLength) return;
	if (id) {
		id = String(id);
		const game = privateGames.get(id);
		if (game) new Player(ws, game, username);
		else {
			const mode = verify(id);
			if (mode) {
				const world = mode === 'normal' ?
					publicTerrain : privateTerrains.get(mode);
				if (world) {
					const game = new Game(ws, username, false, world);
					privateGames.set(id, game);
					keys.set(game, id);
				} else ws.close();
			}
		}
	} else {
		for (const game of publicGames) {
			if (game.players.size < Game.maxPlayers) {
				return new Player(ws, game, username);
			}
		}
		publicGames.add(new Game(ws, username, true));	
	}
});