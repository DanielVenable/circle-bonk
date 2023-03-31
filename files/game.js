const [chatbox, chatinput, usernameinput, play,
        start_screen, canvas, player_list, score_list, scoreboard] =
    ['chatbox', 'chatinput', 'displayname', 'play',
        'start', 'canvas', 'players', 'scores', 'scoreboard']
        .map(document.getElementById.bind(document)),
    keys = new Set([
        'ArrowUp',
        'ArrowLeft',
        'ArrowDown',
        'ArrowRight'
    ]),
    keys_down = new Set,
    players = new Map,
    dead_guys = new Set,
    ctx = canvas.getContext('2d'),
    scale = 10;

let on_screen = new Set,
    treasure_pos = [],
    ws, my_id,
    walls = [],
    teams = [],
    goals = [],
    angle = 0,
    playing = false;

ctx.imageSmoothingEnabled = false;
ctx.textAlign = 'center';
ctx.font = '5px arial';

function set_property(id, property, value) {
    const player = players.get(id);
    if (player) player[property] = value;
    else players.set(id, { [property]: value });
}

usernameinput.value = localStorage.display_name || '';
usernameinput.select();
usernameinput.addEventListener('keydown', ({ key }) => {
    if (key === 'Enter') start();
});

function start() {
    playing = true;
    if (!ws) setup();
    else {
        ws.send(JSON.stringify({
            type: 'restart',
            username: localStorage.display_name = usernameinput.value
        }));
    }
    play.hidden = false;
    start_screen.hidden = true;
    resize();
}

function setup() {
    play.hidden = false;
    ws = new WebSocket(
        `ws${window.location.protocol === 'http:' ? '' : 's' }://${
            window.location.hostname
        }:${
            window.location.port
        }/?username=${
            encodeURIComponent(
                localStorage.display_name = usernameinput.value)
        }%s`);

    document.addEventListener('keydown', e => handle_key(e, true));
    document.addEventListener('keyup', e => handle_key(e, false));

    ws.onmessage = ({ data }) => {
        const { type, message, name, color, id, pos, treasures } =
            JSON.parse(data);
        switch (type) {
            case 'message':
                append_chat(message, players.get(id).username);
            break; case 'player':
                set_property(id, 'username', name);
                set_property(id, 'color', color);
                update_player_list();
            break; case 'position':
                on_screen = new Set();
                if (pos) on_screen.add(my_id);
                treasure_pos = treasures;
                for (const [id, pos] of message) {
                    on_screen.add(id);
                    set_property(id, 'position', pos);
                }
                if (pos) {
                    set_property(my_id, 'position', pos);
                    ctx.setTransform(scale, 0, 0, scale,
                        canvas.width  / 2 - pos[0] * scale,
                        canvas.height / 2 - pos[1] * scale);
                }
            break; case 'bye':
                players.delete(id);
                update_player_list();
            break; case 'start':
                walls = message;
                my_id = id;
                set_property(id, 'username', usernameinput.value);
            break; case 'goal':
                teams = color;
                goals = message;
            break; case 'die':
                const player = players.get(id);
                player.death_date = Date.now();
                dead_guys.add(player);
                players.delete(id);
                on_screen.delete(id);
                if (id === my_id) {
                    playing = false;
                    start_screen.hidden = false;
                    usernameinput.select();
                    resize();
                }
                update_player_list();
                setTimeout(() => dead_guys.delete(player), 1000);
            break; case 'leave':
                on_screen.delete(id);
            break; case 'score':
                update_score_list(message);
            break; default:
                throw new Error('Invalid type: ' + type);
        }
    }

    ws.onclose = () => {
        if (confirm('Oh no! The connection is lost. Click OK to reload')) {
            window.location.reload();
        }
    }

    function update() {
        ctx.save();
        ctx.resetTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        for (let i = 0; i < teams.length; i++) {
            ctx.fillStyle = teams[i];
            for (const goal of goals[i]) {
                ctx.fillRect(...goal);
            }
        }

        ctx.fillStyle = '#000000';

        for (const wall of walls) {
            ctx.fillRect(...wall);
        }

        for (const { position, color } of iterator()) {
            if (!position) continue;
            ctx.fillStyle = color || '#000000';
            ctx.beginPath();
            ctx.arc(...position, 5, 0, 2 * Math.PI);
            ctx.fill();
        }

        ctx.globalAlpha = 1;

        for (const { username, position, color } of iterator()) {
            if (!position || !username) continue;
            ctx.fillStyle = color || '#000000';
            ctx.fillText(username, position[0], position[1] - 6);
        }

        ctx.globalAlpha = 1;

        ctx.fillStyle = '#ffff00';
        for (const treasure of treasure_pos) {
            ctx.fillRect(...treasure, 10, 10);
        }

        const me = players.get(my_id);
        if (me && me.position) {
            const [x, y] = me.position;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
            ctx.stroke();
        }

        function* iterator() {
            for (const id of on_screen) {
                yield players.get(id);
            }
            for (const player of dead_guys) {
                ctx.globalAlpha = 1 - (Date.now() - player.death_date) / 1000;
                yield player;
            }
        }
    }

    function handle_key(event, is_down) {
        if (keys.has(event.code)) {
            keys_down[is_down ? 'add' : 'delete'](event.code);
            if (!playing) return;
            event.preventDefault();
            let accel = 0;
            if (keys_down.has('ArrowUp')) accel++;
            if (keys_down.has('ArrowDown')) accel--;
            ws.send(JSON.stringify({
                type: 'position',
                x: Math.cos(angle) * accel,
                y: Math.sin(angle) * accel
            }));
        } else if (chatbox && event.target !== chatinput && playing) {
            chatinput.focus();
        }
    }

    function update_player_list() {
        player_list.textContent = '';
        for (const { username } of players.values()) {
            if (username === undefined) continue;
            const elem = document.createElement('li');
            elem.textContent = username;
            player_list.appendChild(elem);
        }
    }

    function update_score_list(score) {
        scoreboard.hidden = false;
        score_list.textContent = '';
        for (let i = 0; i < teams.length; i++) {
            const elem = document.createElement('span');
            elem.textContent = score[i] + ' ';
            elem.style.color = teams[i];
            score_list.appendChild(elem);
        }
    }

    setInterval(() => {
        if (keys_down.has('ArrowLeft'))  angle -= Math.PI / 20;
        if (keys_down.has('ArrowRight')) angle += Math.PI / 20;
    }, 50);

    setInterval(update, 50);
    resize();

    function chat_listener({ key }) {
        if (key === 'Enter') {
            ws.send(JSON.stringify({
                type: 'message',
                message: chatinput.value
            }));
            append_chat(chatinput.value);
            chatinput.value = '';
        }
    }

    if (chatbox) chatinput.addEventListener('keydown', chat_listener);

    function append_chat(text, username) {
        const elem = document.createElement('p');
        const name = document.createElement(
            username === undefined ? 'span' : 'b');
        name.textContent =
            (username === undefined ? '(You)' : username) + ': ';
        elem.appendChild(name);
        elem.insertAdjacentText('beforeend', text);
        chatbox.prepend(elem);
    }
}

window.addEventListener('resize', resize);

function resize() {
    let num = 99;
    play.style.width = '100%';
    while (num && document.documentElement.clientHeight <
        document.documentElement.scrollHeight) {
        play.style.width = (num--) + '%';
    }
}