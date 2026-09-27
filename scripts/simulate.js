// Play the game from your terminal without Kick or a web server:
//   npm run simulate                 (interactive, you are "TestViewer")
//   npm run simulate -- Alice        (interactive as Alice)
// Uses the same database as the server, so progress shows up on the website.
const readline = require('node:readline');
const config = require('../src/config');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');

const username = process.argv[2] || 'TestViewer';
const repo = openDb(config.dbPath);
const engine = new GameEngine({ repo, config });
const kickUserId = repo.getUserByName(username)?.kick_user_id || `dev-${username.toLowerCase()}`;

console.log(`Chatting as ${username}. Try !fish, !mine, !chop, !dig, !smelt, !stats, !inv, !sell all. Ctrl+C to quit.`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${username}> ` });
rl.prompt();
rl.on('line', (line) => {
  const { reply } = engine.handleChat({ kickUserId, username, content: line });
  if (reply) console.log(`🤖 ${reply}`);
  rl.prompt();
});
rl.on('close', () => repo.close());
