const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let gameRoom = [];
let guessGameState = {};

// Expanded word list
const wordLists = {
    easy: [
        "APPLE", "DREAM", "WATER", "BIRD", "DOG", "SUN", "HOUSE", "FLOWER", "HAPPY", "GHOST",
        "SMOKE", "CLOUDS", "TABLE", "CHAIR", "BOOK", "PANTS", "COFFEE", "MUSIC", "GAMES", "PIZZA"
    ],
    medium: [
        "MOUNTAIN", "KEYBOARD", "PLANET", "FRIENDSHIP", "ALPHABET", "GUITAR", "OCEAN", "CASTLE",
        "JOURNEY", "FESTIVAL", "PENCIL", "BLIZZARD", "SUNFLOWER", "OCTOPUS", "COMPUTER", "PROGRAMMING"
    ],
    hard: [
        "AMBIGUOUS", "EXAGGERATE", "INNOVATION", "PHOENIX", "SYMPHONY", "QUICKSAND",
        "ZEPHYR", "JUXTAPOSE", "PARADIGM", "SERENDIPITY", "UNEMPLOYMENT", "INCORRIGIBLE"
    ]
};

// Function to get a random word from a chosen difficulty
function getRandomWord() {
    const difficulties = Object.keys(wordLists);
    const randomDifficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
    const wordList = wordLists[randomDifficulty];
    return wordList[Math.floor(Math.random() * wordList.length)];
}

// Function to initialize a new Word Guessing Game
function initializeGuessingGame() {
    const word = getRandomWord();
    guessGameState = {
        currentWord: word,
        displayWord: Array(word.length).fill('_'),
        turnsLeft: 6,
        guessedLetters: [],
        gameStatus: 'playing',
        message: `The word has ${word.length} letters.`,
        hint: '',
    };
}

wss.on("connection", (ws) => {
    console.log("✅ New client connected.");
    ws.id = Math.random().toString(36).substring(7);
    gameRoom.push(ws);
    
    ws.send(JSON.stringify({ type: 'client_joined', message: 'Connected to the server.' }));

    if (gameRoom.length === 2) {
        console.log("➡️ Two clients connected. Starting peer connections and games.");
        gameRoom[0].send(JSON.stringify({ type: 'peer_connected' }));
        initializeGuessingGame();
        gameRoom.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'guess_game_state', ...guessGameState }));
            }
        });
    }

    ws.on("message", (message) => {
        let data;
        try {
            data = JSON.parse(message.toString());
        } catch (err) {
            console.error("❌ Invalid JSON:", message.toString());
            return;
        }
        
        if (['offer', 'answer', 'candidate', 'end_call'].includes(data.type)) {
            const otherClient = gameRoom.find(client => client !== ws);
            if (otherClient && otherClient.readyState === WebSocket.OPEN) {
                otherClient.send(JSON.stringify(data));
            }
            return;
        }
        
        if (data.type === 'chat_message') {
            gameRoom.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
            return;
        }
        
        const playerClient = gameRoom.find(client => client.id === ws.id);

        if (data.type === 'guess_game_move' && guessGameState.gameStatus === 'playing') {
            const guess = data.guess.toUpperCase();
            if (guess.length !== 1 || !/^[A-Z]$/.test(guess) || guessGameState.guessedLetters.includes(guess)) {
                return;
            }
            let found = false;
            for (let i = 0; i < guessGameState.currentWord.length; i++) {
                if (guessGameState.currentWord[i] === guess) {
                    guessGameState.displayWord[i] = guess;
                    found = true;
                }
            }
            if (found) {
                guessGameState.message = "Good guess!";
            } else {
                guessGameState.turnsLeft--;
                guessGameState.message = `Sorry, '${guess}' is not in the word.`;
            }
            guessGameState.guessedLetters.push(guess);
            if (!guessGameState.displayWord.includes('_')) {
                guessGameState.message = `Congratulations! The word was: ${guessGameState.currentWord} 🎉`;
                guessGameState.gameStatus = 'over';
            } else if (guessGameState.turnsLeft <= 0) {
                guessGameState.message = `You ran out of turns. The word was: ${guessGameState.currentWord} 😔`;
                guessGameState.gameStatus = 'over';
            }
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'guess_game_state', ...guessGameState }));
                }
            });
            return;
        }
        
        if (data.type === 'guess_game_restart') {
            initializeGuessingGame();
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'guess_game_state', ...guessGameState }));
                }
            }
            );
            return;
        }
    });

    ws.on("close", () => {
        console.log("❌ Client disconnected.");
        gameRoom = gameRoom.filter(client => client.id !== ws.id);
        if (gameRoom.length === 1) {
            console.log("Only one client remaining. Restarting games.");
            initializeGuessingGame();
            gameRoom[0].send(JSON.stringify({ type: 'guess_game_state', ...guessGameState }));
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});

app.get('/healthz', (req, res) => {
    res.status(200).send('ok');
});