/* U.S. NAVAL COOPERATION TEST - server.js
   Full server implementation (complete file).
   Changes:
   - Re-engage creates new room and moves both players into it (reliable).
   - All startGame/nextRound/startNumberSequence emits include a server startTime.
     Clients will use server startTime as authoritative to avoid elapsed-time drift.
*/
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const teamDataPath = path.join(__dirname, 'teams.json');
let teamStats = {};

// Re-engage status tracking
const reengageStatus = {};

// Game constants
const GAME_CONSTANTS = {
  TOTAL_ROUNDS: 3,
  INITIAL_COUNTDOWN: 100,  // 25 dots × 4 seconds each = 100 seconds
  PERSONAL_TIMER_START: 100,  // 25 dots × 4 seconds each = 100 seconds
  NUMBER_SEQUENCE_TIME: 100,  // 25 dots × 4 seconds each = 100 seconds
  SUCCESS_BONUS: 4,
  FAILURE_PENALTY: 3
};

// Partnership chain - clockwise by quadrant visual position
// Layout:  YELLOW | BLUE
//          -------|------
//          RED    | GREEN
// Clockwise: Yellow → Blue → Green → Red → Yellow
const PARTNERSHIP_CHAIN = {
  yellow: 'blue',
  blue: 'green',
  green: 'red',
  red: 'yellow'
};

// Load existing team stats
if (fs.existsSync(teamDataPath)) {
  try {
    teamStats = JSON.parse(fs.readFileSync(teamDataPath, 'utf-8'));
  } catch (error) {
    console.log('No existing team data found, starting fresh...');
    teamStats = {};
  }
}

function generateTeamName() {
  const adjectives = ['STEALTH', 'RAPID', 'PRECISE', 'VALIANT', 'FEARLESS', 'NOBLE', 'ELITE', 'TACTICAL'];
  const nouns = ['WARRIORS', 'STRIKERS', 'DEFENDERS', 'SENTINELS', 'GUARDIANS', 'VANGUARD', 'PHANTOMS', 'SPARTANS'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

// Helper: generate short room codes for re-engage
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Helper: generate fake IP addresses for display
function generateFakeIP() {
  const part1 = Math.floor(Math.random() * 256);
  const part2 = Math.floor(Math.random() * 256);
  return `${part1}.${part2}.XXX.XXX`;
}

// Get all available rooms for lobby browser
function getAvailableRooms() {
  const availableRooms = [];
  
  for (const [roomCode, roomData] of Object.entries(rooms)) {
    const playerCount = Object.keys(roomData.players).length;
    
    // Only show rooms that are waiting for players (not full and not in game)
    if (playerCount > 0 && playerCount < 4 && !roomData.gameActive) {
      const players = Object.keys(roomData.players).map(color => ({
        color: color,
        username: roomData.players[color].username
      }));
      
      availableRooms.push({
        roomCode: roomCode,
        teamName: roomData.teamName,
        players: players,
        playerCount: playerCount,
        maxPlayers: 4,
        spotsLeft: 4 - playerCount
      });
    }
  }
  
  return availableRooms;
}

// Broadcast available rooms to all clients in lobby
function broadcastAvailableRooms() {
  const availableRooms = getAvailableRooms();
  io.emit('lobbyUpdate', { rooms: availableRooms });
  console.log(`📡 Broadcasting ${availableRooms.length} available room(s) to all clients`);
}

function generateFindSixGrid() {
  const grid = Array(24).fill('9');
  let sixes = Math.floor(Math.random() * 3) + 1; // 1-3 sixes
  while (sixes > 0) {
    const i = Math.floor(Math.random() * 24);
    if (grid[i] === '9') {
      grid[i] = '6';
      sixes--;
    }
  }
  return grid;
}

function generateFindNineGrid() {
  const grid = Array(24).fill('6');
  let nines = Math.floor(Math.random() * 3) + 1; // 1-3 nines
  while (nines > 0) {
    const i = Math.floor(Math.random() * 24);
    if (grid[i] === '6') {
      grid[i] = '9';
      nines--;
    }
  }
  return grid;
}

function generateGameSequence(players) {
  const gameTypes = ['findSix', 'findNine', 'colorMatch', 'shapeMemory', 'memoryChallenge'];
  const playerColors = Object.keys(players);
  const sequence = [];
  
  // Generate 3 rounds of games
  for (let round = 0; round < 3; round++) {
    const roundGames = {};
    let lastGames = round > 0 ? sequence[round - 1] : {};
    
    playerColors.forEach(color => {
      // Available games (excluding the last one this player had)
      const availableGames = lastGames[color] 
        ? gameTypes.filter(g => g !== lastGames[color])
        : gameTypes;
      
      // Pick a random game from available
      const randomGame = availableGames[Math.floor(Math.random() * availableGames.length)];
      roundGames[color] = randomGame;
    });
    
    sequence.push(roundGames);
  }
  
  return sequence;
}

function generateGameData(gameType) {
  switch(gameType) {
    case 'findSix':
      return { grid: generateFindSixGrid() };
    case 'findNine':
      return { grid: generateFindNineGrid() };
    case 'colorMatch':
      return {}; // Color match generates its own data on client
    case 'shapeMemory':
      return {}; // Shape memory generates its own data on client
    case 'memoryChallenge':
      return {}; // Memory challenge generates its own data on client
    default:
      return {};
  }
}

function generateNumberSequence(players) {
  const numbers = Array.from({length: 12}, (_, i) => i + 1);
  const sequence = {};
  
  // Shuffle numbers randomly between players
  const shuffled = [...numbers].sort(() => Math.random() - 0.5);
  
  // Assign numbers evenly to each player (12 numbers / 4 players = 3 each)
  const playerColors = Object.keys(players);
  const numbersPerPlayer = Math.floor(12 / playerColors.length); // 3 for 4 players
  
  playerColors.forEach((color, playerIndex) => {
    const playerNumbers = shuffled.slice(playerIndex * numbersPerPlayer, (playerIndex + 1) * numbersPerPlayer);
    playerNumbers.forEach(num => {
      sequence[num] = color;
    });
  });
  
  console.log(`Generated number sequence for ${playerColors.length} players (${numbersPerPlayer} numbers each):`, sequence);
  return sequence;
}

// NEW FUNCTION: Generate consistent positions for number sequence
function generateNumberSequencePositions() {
  const positions = {};
  const usedPositions = new Set();
  
  for (let number = 1; number <= 12; number++) {
    let validPosition = false;
    let attempts = 0;
    let x, y, positionKey;
    
    while (!validPosition && attempts < 100) {
      // Generate random positions within reasonable bounds (15-85% of container)
      x = Math.floor(Math.random() * 70) + 15;
      y = Math.floor(Math.random() * 70) + 15;
      positionKey = `${x},${y}`;
      
      // Check if position is too close to center (where Total Time clock is)
      const centerX = 50;
      const centerY = 50;
      const distanceFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      const minCenterDistance = 20; // Minimum distance from center to avoid clock
      
      if (!usedPositions.has(positionKey) && distanceFromCenter >= minCenterDistance) {
        // Check if this position is too close to existing positions
        let tooClose = false;
        for (const existingKey of usedPositions) {
          const [existingX, existingY] = existingKey.split(',').map(Number);
          const distance = Math.sqrt(Math.pow(x - existingX, 2) + Math.pow(y - existingY, 2));
          if (distance < 15) { // Minimum distance between circles
            tooClose = true;
            break;
          }
        }
        
        if (!tooClose) {
          validPosition = true;
          usedPositions.add(positionKey);
        }
      }
      
      attempts++;
    }
    
    // If no valid position found after attempts, use a grid-based fallback (avoiding center)
    if (!validPosition) {
      const cols = 4;
      const rows = 3;
      const col = (number - 1) % cols;
      const row = Math.floor((number - 1) / cols);
      
      // Position in corners and edges, avoiding center
      if (col < 2) {
        x = col * 20 + 15 + (Math.random() * 5);
      } else {
        x = col * 20 + 25 + (Math.random() * 5);
      }
      
      if (row === 1) {
        // Middle row - push to sides
        y = col < 2 ? row * 25 + 10 : row * 25 + 30;
      } else {
        y = row * 25 + 15 + (Math.random() * 10 - 5);
      }
      
      positionKey = `${x},${y}`;
    }
    
    positions[number] = { x, y };
  }
  
  return positions;
}

function saveTeamStats() {
  try {
    fs.writeFileSync(teamDataPath, JSON.stringify(teamStats, null, 2));
    console.log('Team stats saved successfully');
  } catch (error) {
    console.error('Error saving team stats:', error);
  }
}

function getTop3Teams() {
  const completedTeams = [];
  
  for (const [teamName, records] of Object.entries(teamStats)) {
    const completedGames = records.filter(r => r.completed);
    if (completedGames.length > 0) {
      const bestTime = Math.max(...completedGames.map(r => r.time));
      const bestGame = completedGames.find(r => r.time === bestTime);
      
      completedTeams.push({
        teamName: teamName,
        time: bestTime,
        players: bestGame.players || [],
        date: bestGame.date
      });
    }
  }
  
  completedTeams.sort((a, b) => b.time - a.time);
  return completedTeams.slice(0, 3);
}

// Start server-side authoritative timer countdown
function startServerTimerCountdown(room) {
  if (!rooms[room]) return;
  
  // Clear any existing interval
  if (rooms[room].timerInterval) {
    clearInterval(rooms[room].timerInterval);
  }
  
  console.log(`⏱️  Starting server-side timer countdown for room ${room}`);
  
  // Count down every second
  rooms[room].timerInterval = setInterval(() => {
    if (!rooms[room] || !rooms[room].gameActive) {
      console.log(`Stopping timer for room ${room} - game no longer active`);
      if (rooms[room] && rooms[room].timerInterval) {
        clearInterval(rooms[room].timerInterval);
        rooms[room].timerInterval = null;
      }
      return;
    }
    
    // Skip countdown during Number Sequence
    if (rooms[room].inNumberSequence) {
      return; // Don't count down personal timers during Number Sequence
    }
    
    // Decrement all personal timers
    const playerColors = Object.keys(rooms[room].personalTimers);
    playerColors.forEach(color => {
      if (rooms[room].personalTimers[color] > 0) {
        rooms[room].personalTimers[color]--;
      }
    });
    
    // Broadcast current timer state to all clients
    io.to(room).emit('timerUpdate', {
      personalTimers: rooms[room].personalTimers
    });
    
    // Check if any timer has expired (but not during Number Sequence)
    if (!rooms[room].inNumberSequence) {
      const expiredPlayer = playerColors.find(
        color => rooms[room].personalTimers[color] <= 0
      );
      
      if (expiredPlayer) {
        console.log(`⏰ Player ${expiredPlayer}'s timer expired in room ${room}! Game Over.`);
        rooms[room].gameActive = false;
        
        // Clear the interval
        clearInterval(rooms[room].timerInterval);
        rooms[room].timerInterval = null;
        
        // Clear number sequence trigger
        if (rooms[room].numberSequenceTrigger) {
          clearTimeout(rooms[room].numberSequenceTrigger);
        }
        
        // Calculate game stats for failure screen
        const endTime = Date.now();
        const duration = ((endTime - rooms[room].startTime) / 1000).toFixed(2);
        const teamName = rooms[room].teamName;
        
        // Save to team stats
        if (!teamStats[teamName]) {
          teamStats[teamName] = [];
        }
        
        teamStats[teamName].push({
          time: parseFloat(duration),
          date: new Date().toISOString(),
          players: Object.values(rooms[room].players).map(p => p.username),
          timeout: true,
          completed: false,
          reason: `Player ${expiredPlayer.toUpperCase()} timer expired`
        });
        
        saveTeamStats();
        
        // Get leaderboard data
        const completedTeams = Object.values(teamStats)
          .filter(records => records.some(r => r.completed));
        
        const bestTime = completedTeams.length > 0 ? 
          Math.max(...completedTeams.map(records => 
            Math.max(...records.filter(r => r.completed).map(r => r.time))
          )) : parseFloat(duration);
        
        const allBestTimes = completedTeams.map(records =>
          Math.max(...records.filter(r => r.completed).map(r => r.time))
        );
        
        const sorted = [...allBestTimes].sort((a, b) => b - a);
        const rank = sorted.length > 0 ? (sorted.indexOf(bestTime) + 1) : 1;
        
        // Emit gameOver with full data for failure screen
        io.to(room).emit('gameOver', {
          teamName,
          time: duration,
          bestTime,
          rank,
          totalTeams: Math.max(sorted.length, 1),
          timeout: true,
          completed: false,
          players: Object.values(rooms[room].players).map(p => p.username),
          top3: getTop3Teams(),
          reason: `Player ${expiredPlayer.toUpperCase()} timer expired`
        });
        
        console.log(`Game over - Player timer expired in room ${room}. Team: ${teamName}, Time: ${duration}s`);
        
        // Mark room as completed
        rooms[room].completed = true;
      }
    }
  }, 1000); // Run every 1 second
}

// Stop server-side timer countdown
function stopServerTimerCountdown(room) {
  if (rooms[room] && rooms[room].timerInterval) {
    console.log(`⏱️  Stopping server-side timer countdown for room ${room}`);
    clearInterval(rooms[room].timerInterval);
    rooms[room].timerInterval = null;
  }
}

// Start Number Sequence timer (server-authoritative)
function startNumberSequenceTimer(room) {
  if (!rooms[room]) return;
  
  // Clear any existing interval
  if (rooms[room].numberSequenceTimerInterval) {
    clearInterval(rooms[room].numberSequenceTimerInterval);
  }
  
  // Reset timer to full
  rooms[room].numberSequenceTimer = GAME_CONSTANTS.NUMBER_SEQUENCE_TIME;
  
  console.log(`⏱️  Starting Number Sequence timer countdown for room ${room}`);
  
  // Count down every second
  rooms[room].numberSequenceTimerInterval = setInterval(() => {
    if (!rooms[room] || !rooms[room].gameActive || !rooms[room].inNumberSequence) {
      console.log(`Stopping Number Sequence timer for room ${room}`);
      if (rooms[room] && rooms[room].numberSequenceTimerInterval) {
        clearInterval(rooms[room].numberSequenceTimerInterval);
        rooms[room].numberSequenceTimerInterval = null;
      }
      return;
    }
    
    // Decrement timer
    if (rooms[room].numberSequenceTimer > 0) {
      rooms[room].numberSequenceTimer--;
    }
    
    // Broadcast current timer state to all clients
    io.to(room).emit('numberSequenceTimerUpdate', {
      timer: rooms[room].numberSequenceTimer
    });
    
    // Check if timer expired
    if (rooms[room].numberSequenceTimer <= 0) {
      console.log(`⏰ Number Sequence timer expired in room ${room}! Game Over.`);
      rooms[room].gameActive = false;
      
      // Clear the interval
      clearInterval(rooms[room].numberSequenceTimerInterval);
      rooms[room].numberSequenceTimerInterval = null;
      
      // Clear number sequence trigger
      if (rooms[room].numberSequenceTrigger) {
        clearTimeout(rooms[room].numberSequenceTrigger);
      }
      
      // Calculate game stats for failure screen
      const endTime = Date.now();
      const duration = ((endTime - rooms[room].startTime) / 1000).toFixed(2);
      const teamName = rooms[room].teamName;
      
      // Save to team stats
      if (!teamStats[teamName]) {
        teamStats[teamName] = [];
      }
      
      teamStats[teamName].push({
        time: parseFloat(duration),
        date: new Date().toISOString(),
        players: Object.values(rooms[room].players).map(p => p.username),
        timeout: true,
        completed: false,
        reason: 'Number Sequence timer expired'
      });
      
      saveTeamStats();
      
      // Get leaderboard data
      const completedTeams = Object.values(teamStats)
        .filter(records => records.some(r => r.completed));
      
      const bestTime = completedTeams.length > 0 ? 
        Math.max(...completedTeams.map(records => 
          Math.max(...records.filter(r => r.completed).map(r => r.time))
        )) : parseFloat(duration);
      
      const allBestTimes = completedTeams.map(records =>
        Math.max(...records.filter(r => r.completed).map(r => r.time))
      );
      
      const sorted = [...allBestTimes].sort((a, b) => b - a);
      const rank = sorted.length > 0 ? (sorted.indexOf(bestTime) + 1) : 1;
      
      // Emit gameOver with full data for failure screen
      io.to(room).emit('gameOver', {
        teamName,
        time: duration,
        bestTime,
        rank,
        totalTeams: Math.max(sorted.length, 1),
        timeout: true,
        completed: false,
        players: Object.values(rooms[room].players).map(p => p.username),
        top3: getTop3Teams(),
        reason: 'Number Sequence timer expired'
      });
      
      console.log(`Game over - Number Sequence timer expired in room ${room}. Team: ${teamName}, Time: ${duration}s`);
      
      // Mark room as completed
      rooms[room].completed = true;
    }
  }, 1000); // Run every 1 second
}

// Stop Number Sequence timer
function stopNumberSequenceTimer(room) {
  if (rooms[room] && rooms[room].numberSequenceTimerInterval) {
    console.log(`⏱️  Stopping Number Sequence timer for room ${room}`);
    clearInterval(rooms[room].numberSequenceTimerInterval);
    rooms[room].numberSequenceTimerInterval = null;
  }
}

// Start random trigger for Number Sequence (60-90 seconds)
function startNumberSequenceTrigger(room) {
  if (!rooms[room]) return;
  
  // Clear any existing trigger
  if (rooms[room].numberSequenceTrigger) {
    clearTimeout(rooms[room].numberSequenceTrigger);
  }
  
  // Random time between 60-90 seconds (60000-90000 ms)
  const triggerTime = Math.floor(Math.random() * 30000) + 60000;
  console.log(`🎯 Number Sequence trigger set for ${triggerTime/1000}s in room ${room}`);
  
  rooms[room].numberSequenceTrigger = setTimeout(() => {
    if (!rooms[room] || !rooms[room].gameActive) return;
    
    console.log(`🚨 FORCED NUMBER SEQUENCE in room ${room}!`);
    
    // CRITICAL: Set flag FIRST to stop timer countdown immediately
    rooms[room].inNumberSequence = true;
    
    // Reset all timers to full (safe now that countdown is paused)
    Object.keys(rooms[room].personalTimers).forEach(color => {
      rooms[room].personalTimers[color] = GAME_CONSTANTS.PERSONAL_TIMER_START;
    });
    
    // Generate number sequence
    rooms[room].numberSequenceState = generateNumberSequence(rooms[room].players);
    rooms[room].currentSequence = 1;
    
    // Generate positions and start number sequence
    const positions = generateNumberSequencePositions();
    io.to(room).emit('forceNumberSequence', {
      sequenceData: rooms[room].numberSequenceState,
      players: rooms[room].players,
      positions: positions,
      personalTimers: rooms[room].personalTimers,
      numberSequenceTimer: rooms[room].numberSequenceTimer
    });
    
    // Start server-side Number Sequence timer
    startNumberSequenceTimer(room);
    
    console.log('Number sequence forced with full timers:', rooms[room].personalTimers);
  }, triggerTime);
}



io.on('connection', socket => {
  console.log('User connected:', socket.id);
  
  // Send current available rooms to newly connected client
  const availableRooms = getAvailableRooms();
  socket.emit('lobbyUpdate', { rooms: availableRooms });
  console.log(`Sent ${availableRooms.length} available room(s) to new client ${socket.id}`);

  // NEW: Handle room preview requests (before joining)
  socket.on('peekRoom', ({ room }) => {
    console.log(`Peek request for room: ${room}`);
    
    if (rooms[room]) {
      // Room exists - send info about players
      const players = Object.keys(rooms[room].players).map(color => ({
        username: rooms[room].players[color].username,
        color: color
      }));
      
      socket.emit('roomPreview', {
        room: room,
        exists: true,
        players: players,
        full: players.length >= 2
      });
      
      console.log(`Room ${room} preview sent: ${players.length} player(s)`);
    } else {
      // Room doesn't exist yet
      socket.emit('roomPreview', {
        room: room,
        exists: false,
        players: [],
        full: false
      });
      
      console.log(`Room ${room} does not exist yet`);
    }
  });

  socket.on('joinRoom', ({ room, username }) => {
    console.log(`Join attempt: room=${room}, username=${username}`);
    
    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = {
        players: {},
        gameSequence: [],
        currentRound: 0,
        roundCompleted: {},
        startTime: null,
        teamName: generateTeamName(),
        gameActive: false,
        currentSequence: 1,
        numberSequenceState: {},
        numberSequenceStarted: false,
        personalTimers: {
          yellow: GAME_CONSTANTS.PERSONAL_TIMER_START,
          blue: GAME_CONSTANTS.PERSONAL_TIMER_START,
          red: GAME_CONSTANTS.PERSONAL_TIMER_START,
          green: GAME_CONSTANTS.PERSONAL_TIMER_START
        },
        gameCompletionTracking: {
          yellow: false,
          blue: false,
          red: false,
          green: false
        },
        timerInterval: null  // Store the countdown interval ID
      };
      
      // Initialize mini-games mode trigger
      rooms[room].inNumberSequence = false;
      rooms[room].numberSequenceTrigger = null;  // Will store timeout for random trigger
      rooms[room].numberSequenceTimerInterval = null;  // Will store Number Sequence countdown interval
      rooms[room].numberSequenceTimer = GAME_CONSTANTS.NUMBER_SEQUENCE_TIME;  // 100 seconds
    }

    // Check if room is full
    if (Object.keys(rooms[room].players).length >= 4) {
      socket.emit('roomFull');
      return;
    }

    // Assign colors in order (yellow, blue, red, green for 4-player game)
    const colors = ['yellow', 'blue', 'red', 'green'];
    const availableColors = colors.filter(color => !rooms[room].players[color]);
    
    if (availableColors.length === 0) {
      socket.emit('roomFull');
      return;
    }

    const assignedColor = availableColors[0];
    rooms[room].players[assignedColor] = {
      socketId: socket.id,
      username: username
    };

    console.log(`Player ${username} joined room ${room} as ${assignedColor}. Players: ${Object.keys(rooms[room].players).length}/2`);

    // Get list of all player usernames in the room
    const playersInRoom = Object.keys(rooms[room].players).map(color => {
      return rooms[room].players[color].username;
    });
    
    // Create a mapping of username -> color for all players in the room
    const playerColors = {};
    Object.keys(rooms[room].players).forEach(color => {
      playerColors[rooms[room].players[color].username] = color;
    });

    // Notify player of their color immediately, along with list of players in room
    socket.emit('colorAssigned', { 
      color: assignedColor,
      players: playersInRoom,
      teamName: rooms[room].teamName,
      playerColors: playerColors  // Add full color mapping
    });
    
    // Broadcast updated lobby to ALL clients (so others see this player joined)
    broadcastAvailableRooms();
    
    // Notify other players in the room that a new player joined (REAL-TIME UPDATE)
    console.log(`📡 Notifying other players in room ${room} that ${username} joined`);
    console.log(`   Players to notify:`, playersInRoom.filter(p => p !== username));
    
    // Reuse the playerColors mapping created above
    socket.to(room).emit('playerJoined', {
      username: username,
      color: assignedColor,
      players: playersInRoom,
      playerColors: playerColors  // Add full color mapping
    });
    console.log(`✅ playerJoined event emitted to room ${room}`);

    // Start when 4 players join
    if (Object.keys(rooms[room].players).length === 4) {
      console.log(`Room ${room} is full with 4 players. Starting game sequence...`);
      
      // Room is now full - broadcast update to remove from lobby list
      broadcastAvailableRooms();
      
      // Generate game sequence for all players (3 rounds)
      rooms[room].gameSequence = generateGameSequence(rooms[room].players);
      
      // Initialize round completion tracking
      Object.keys(rooms[room].players).forEach(color => {
        rooms[room].roundCompleted[color] = false;
      });
      
      console.log('Game sequence for room:', rooms[room].gameSequence);
      
      // Notify all players that game is ready
      
      // Get list of all player usernames for gameReady
      const playersInRoom = Object.keys(rooms[room].players).map(color => {
        return rooms[room].players[color].username;
      });
      
      // Notify all players that game is ready with player list
      io.to(room).emit('gameReady', { players: playersInRoom });
      rooms[room].gameActive = true;

      // Start game after countdown (matches initial client countdown: 10s + 3s confirmation)
      setTimeout(() => {
        if (rooms[room]) {
          // set server authoritative start time
          rooms[room].startTime = Date.now();
          
          // Send first round game assignments to all players
          const firstRound = rooms[room].gameSequence[0];
          const playerColors = Object.keys(rooms[room].players);
          const gameAssignments = {};
          
          playerColors.forEach(color => {
            const gameType = firstRound[color];
            gameAssignments[color] = {
              gameType: gameType,
              gameData: generateGameData(gameType)
            };
          });
          
          io.to(room).emit('startGame', {
            teamName: rooms[room].teamName,
            players: rooms[room].players,
            gameAssignments: gameAssignments,
            round: 1,
            totalRounds: 3,
            startTime: rooms[room].startTime,
            personalTimers: rooms[room].personalTimers
          });
          
          // Start server-side authoritative timer countdown
          startServerTimerCountdown(room);
          
          // Start random trigger for Number Sequence (60-90 seconds)
          startNumberSequenceTrigger(room);
          
          console.log(`Game started in room ${room} - Round 1 assignments:`, gameAssignments);
        }
      }, 13000); // 10s countdown + 3s confirmation
    }
  });

  // NEW: Handle request for players data (for 4-player grid countdown)
  socket.on('requestPlayersData', ({ room }) => {
    if (!rooms[room]) {
      console.log(`Room ${room} does not exist`);
      return;
    }
    
    const playersData = {};
    Object.keys(rooms[room].players).forEach(color => {
      playersData[color] = {
        username: rooms[room].players[color].username,
        ip: generateFakeIP() // Generate fake IP for display
      };
    });
    
    socket.emit('playersData', { players: playersData });
    console.log(`Sent players data for room ${room}:`, playersData);
  });

  socket.on('roundComplete', ({ room, color, success = true }) => {
    if (!rooms[room] || !rooms[room].gameActive) {
      console.log(`Game not active in room ${room}`);
      return;
    }

    // Skip if in number sequence mode
    if (rooms[room].inNumberSequence) {
      console.log(`⚠️  Ignoring roundComplete during number sequence`);
      return;
    }

    // Check if this player has already completed their current game
    if (rooms[room].gameCompletionTracking[color]) {
      console.log(`⚠️  ${color} already completed this game - ignoring duplicate`);
      return;
    }

    console.log(`Player ${color} completed game in room ${room} - Success: ${success}`);
    
    // Mark this player as having completed their current game
    rooms[room].gameCompletionTracking[color] = true;
    
    // Apply bonus/penalty to clockwise partner ONLY based on success/failure
    const partnerColor = PARTNERSHIP_CHAIN[color];
    const partnerTimerBefore = rooms[room].personalTimers[partnerColor];
    
    if (success) {
      rooms[room].personalTimers[partnerColor] += GAME_CONSTANTS.SUCCESS_BONUS;
      console.log(`✅ ${color} succeeded!`);
      console.log(`   └─> ${partnerColor}'s timer: ${partnerTimerBefore}s → ${rooms[room].personalTimers[partnerColor]}s (+${GAME_CONSTANTS.SUCCESS_BONUS}s)`);
    } else {
      rooms[room].personalTimers[partnerColor] = Math.max(0, rooms[room].personalTimers[partnerColor] - GAME_CONSTANTS.FAILURE_PENALTY);
      console.log(`❌ ${color} failed!`);
      console.log(`   └─> ${partnerColor}'s timer: ${partnerTimerBefore}s → ${rooms[room].personalTimers[partnerColor]}s (-${GAME_CONSTANTS.FAILURE_PENALTY}s)`);
    }
    
    // Log all timer states for clarity
    console.log(`Current timers after ${color}'s completion:`);
    Object.keys(rooms[room].personalTimers).forEach(playerColor => {
      const marker = playerColor === partnerColor ? ' ← RECEIVED BONUS/PENALTY' : '';
      console.log(`   ${playerColor}: ${rooms[room].personalTimers[playerColor]}s${marker}`);
    });
    
    // Broadcast updated timers to all players
    io.to(room).emit('timerUpdate', { 
      personalTimers: rooms[room].personalTimers,
      bonusReceiver: partnerColor,
      bonusAmount: success ? GAME_CONSTANTS.SUCCESS_BONUS : -GAME_CONSTANTS.FAILURE_PENALTY
    });
    
    // Check if any player's timer has expired
    const expiredPlayer = Object.keys(rooms[room].personalTimers).find(
      playerColor => rooms[room].personalTimers[playerColor] <= 0
    );
    
    if (expiredPlayer) {
      console.log(`⏰ Player ${expiredPlayer}'s timer expired! Game Over.`);
      rooms[room].gameActive = false;
      
      // Clear number sequence trigger
      if (rooms[room].numberSequenceTrigger) {
        clearTimeout(rooms[room].numberSequenceTrigger);
      }
      
      // Calculate game stats for failure screen
      const endTime = Date.now();
      const duration = ((endTime - rooms[room].startTime) / 1000).toFixed(2);
      const teamName = rooms[room].teamName;
      
      // Save to team stats
      if (!teamStats[teamName]) {
        teamStats[teamName] = [];
      }
      
      teamStats[teamName].push({
        time: parseFloat(duration),
        date: new Date().toISOString(),
        players: Object.values(rooms[room].players).map(p => p.username),
        timeout: true,
        completed: false,
        reason: `Player ${expiredPlayer.toUpperCase()} timer expired`
      });
      
      saveTeamStats();
      
      // Get leaderboard data
      const completedTeams = Object.values(teamStats)
        .filter(records => records.some(r => r.completed));
      
      const bestTime = completedTeams.length > 0 ? 
        Math.max(...completedTeams.map(records => 
          Math.max(...records.filter(r => r.completed).map(r => r.time))
        )) : parseFloat(duration);
      
      const allBestTimes = completedTeams.map(records =>
        Math.max(...records.filter(r => r.completed).map(r => r.time))
      );
      
      const sorted = [...allBestTimes].sort((a, b) => b - a);
      const rank = sorted.length > 0 ? (sorted.indexOf(bestTime) + 1) : 1;
      
      // Emit gameOver with full data for failure screen
      io.to(room).emit('gameOver', {
        teamName,
        time: duration,
        bestTime,
        rank,
        totalTeams: Math.max(sorted.length, 1),
        timeout: true,
        completed: false,
        players: Object.values(rooms[room].players).map(p => p.username),
        top3: getTop3Teams(),
        reason: `Player ${expiredPlayer.toUpperCase()} timer expired`
      });
      
      console.log(`Game over - Player timer expired in room ${room}. Team: ${teamName}, Time: ${duration}s`);
      
      // Mark room as completed
      rooms[room].completed = true;
      return;
    }
    
    // IMMEDIATELY give this player a new random game
    const gameTypes = ['findSix', 'findNine', 'colorMatch', 'shapeMemory', 'memoryChallenge'];
    const randomGameType = gameTypes[Math.floor(Math.random() * gameTypes.length)];
    const newGameAssignment = {
      gameType: randomGameType,
      gameData: generateGameData(randomGameType)
    };
    
    console.log(`🎮 ${color} gets new game immediately: ${randomGameType}`);
    
    // Reset completion tracking for this player only
    rooms[room].gameCompletionTracking[color] = false;
    
    // Send new game to this specific player only
    const playerSocket = io.sockets.sockets.get(rooms[room].players[color].socketId);
    if (playerSocket) {
      playerSocket.emit('nextGameForYou', {
        gameAssignment: newGameAssignment,
        color: color,
        personalTimers: rooms[room].personalTimers
      });
    }
    
    // CRITICAL FIX: Broadcast to ALL players (including this one) so everyone sees the correct game
    io.to(room).emit('playerGameUpdate', {
      color: color,
      gameType: randomGameType,
      gameData: newGameAssignment.gameData
    });
  });

  socket.on('numberSequenceClick', ({ room, number, color }) => {
    if (!rooms[room] || !rooms[room].gameActive) return;
    
    const gameState = rooms[room];
    
    console.log(`Number sequence click in room ${room}: number=${number}, color=${color}, expected=${gameState.currentSequence}, correctColor=${gameState.numberSequenceState[number]}`);
    
    if (gameState.currentSequence === number && gameState.numberSequenceState[number] === color) {
      // Correct click!
      gameState.currentSequence++;
      console.log(`Correct click! Next number: ${gameState.currentSequence}`);
      
      io.to(room).emit('numberSequenceCorrect', {
        number: number,
        nextNumber: gameState.currentSequence,
        addedTime: true
      });
      
      // Check if game is completed
      if (gameState.currentSequence > 12) {
        console.log(`✅ Number sequence completed in room ${room}! Returning to mini-games...`);
        
        // Stop Number Sequence timer
        stopNumberSequenceTimer(room);
        
        rooms[room].inNumberSequence = false;
        
        // Reset all timers to full
        Object.keys(rooms[room].personalTimers).forEach(color => {
          rooms[room].personalTimers[color] = GAME_CONSTANTS.PERSONAL_TIMER_START;
        });
        
        // Reset completion tracking
        Object.keys(rooms[room].players).forEach(color => {
          rooms[room].gameCompletionTracking[color] = false;
        });
        
        console.log('All timers reset to full:', rooms[room].personalTimers);
        
        // Notify clients that number sequence is complete
        io.to(room).emit('numberSequenceCompleted');
        
        // Return to mini-games after short delay
        setTimeout(() => {
          if (!rooms[room] || !rooms[room].gameActive) return;
          
          // Generate random game for each player
          const gameTypes = ['findSix', 'findNine', 'colorMatch', 'shapeMemory', 'memoryChallenge'];
          const playerColors = Object.keys(rooms[room].players);
          const gameAssignments = {};
          
          playerColors.forEach(color => {
            const randomGameType = gameTypes[Math.floor(Math.random() * gameTypes.length)];
            gameAssignments[color] = {
              gameType: randomGameType,
              gameData: generateGameData(randomGameType)
            };
          });
          
          console.log(`🔄 Returning to mini-games in room ${room}:`, gameAssignments);
          
          // Send all players back to mini-games
          io.to(room).emit('returnToMiniGames', {
            gameAssignments: gameAssignments,
            personalTimers: rooms[room].personalTimers
          });
          
          // Start new random trigger for next Number Sequence
          startNumberSequenceTrigger(room);
        }, 2000);
      }
    } else {
      // Wrong click
      console.log(`Wrong click! Expected number ${gameState.currentSequence} by color ${gameState.numberSequenceState[gameState.currentSequence]}`);
      io.to(room).emit('numberSequenceIncorrect', { number: number });
    }
  });

  socket.on('timeout', ({ room }) => {
    if (!rooms[room]) return;

    console.log(`Timeout in room ${room}`);
    
    const endTime = Date.now();
    const duration = ((endTime - rooms[room].startTime) / 1000).toFixed(2);
    const teamName = rooms[room].teamName;

    if (!teamStats[teamName]) {
      teamStats[teamName] = [];
    }

    teamStats[teamName].push({ 
      time: parseFloat(duration), 
      date: new Date().toISOString(),
      players: Object.values(rooms[room].players).map(p => p.username),
      timeout: true,
      completed: false
    });

    // Save team stats
    saveTeamStats();

    const completedTeams = Object.values(teamStats)
      .filter(records => records.some(r => r.completed));
    
    const bestTime = completedTeams.length > 0 ? 
      Math.max(...completedTeams.map(records => 
        Math.max(...records.filter(r => r.completed).map(r => r.time))
      )) : parseFloat(duration);
    
    const allBestTimes = completedTeams.map(records =>
      Math.max(...records.filter(r => r.completed).map(r => r.time))
    );
    
    const sorted = [...allBestTimes].sort((a, b) => b - a);
    const rank = sorted.length > 0 ? (sorted.indexOf(bestTime) + 1) : 1;

    io.to(room).emit('gameOver', {
      teamName,
      time: duration,
      bestTime,
      rank,
      totalTeams: Math.max(sorted.length, 1),
      timeout: true,
      completed: false,
      top3: getTop3Teams()
    });

    console.log(`Game timeout in room ${room}. Team: ${teamName}, Time: ${duration}s, Rank: ${rank}`);
    
    // Mark room as completed but keep it for re-engagement
    rooms[room].gameActive = false;
    rooms[room].completed = true;
    
    // Set timeout to clean up room after 5 minutes if no re-engage
    rooms[room].cleanupTimeout = setTimeout(() => {
      if (rooms[room] && !reengageStatus[room]) {
        console.log(`Cleaning up inactive room ${room} after 5 minutes`);
        delete rooms[room];
      }
    }, 300000); // 5 minutes
  });

  socket.on('mouseMove', ({ room, color, x, y }) => {
    socket.to(room).emit('partnerMouse', { color, x, y });
  });
  
  // NEW: Handle game actions for partner mirroring
  socket.on('gameAction', ({ room, action, data }) => {
    console.log(`Game action in room ${room}:`, action.gameType, action.actionType);
    // Broadcast game action to partner
    socket.to(room).emit('partnerGameAction', { 
      color: action.color, 
      gameType: action.gameType,
      actionType: action.actionType,
      data: data 
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find and clean up rooms where this socket was playing
    for (const room in rooms) {
      const players = rooms[room].players;
      let disconnectedPlayer = null;
      
      for (const [playerColor, playerData] of Object.entries(players)) {
        if (playerData.socketId === socket.id) {
          disconnectedPlayer = { color: playerColor, username: playerData.username };
          delete rooms[room].players[playerColor];
          break;
        }
      }
      
      if (disconnectedPlayer) {
        console.log(`Player ${disconnectedPlayer.username} (${disconnectedPlayer.color}) disconnected from room ${room}`);
        
        // If room becomes empty, clean it up
        if (Object.keys(rooms[room].players).length === 0) {
          console.log(`Room ${room} is now empty, cleaning up...`);
          
          // Clear any cleanup timeout
          if (rooms[room].cleanupTimeout) {
            clearTimeout(rooms[room].cleanupTimeout);
          }
          
          // Stop timer countdown
          stopServerTimerCountdown(room);
          
          // Clear number sequence trigger
          if (rooms[room].numberSequenceTrigger) {
            clearTimeout(rooms[room].numberSequenceTrigger);
          }
          
          // Stop Number Sequence timer
          stopNumberSequenceTimer(room);
          
          delete rooms[room];
        } else {
          // Notify remaining player
          io.to(room).emit('partnerDisconnected', { 
            color: disconnectedPlayer.color, 
            username: disconnectedPlayer.username 
          });
          console.log(`Notified remaining player in room ${room} about disconnect`);
        }
        
        // Broadcast updated lobby (room might be available again or removed)
        broadcastAvailableRooms();
      }
    }
  
    // Clean up re-engage requests if player disconnects
    for (const roomCode in reengageStatus) {
      if (reengageStatus[roomCode]) {
        io.to(roomCode).emit('reengageCancelled', {
          reason: 'PARTNER DISCONNECTED'
        });
        
        if (reengageStatus[roomCode].timeout) {
          clearTimeout(reengageStatus[roomCode].timeout);
        }
        
        delete reengageStatus[roomCode];
      }
    }

    // Also clear any reengageReady pending state for rooms that lost a player
    for (const roomCode in reengageStatus) {
      // nothing special beyond above cleanup here
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
  
  // Handle re-engage with team requests (NEW: create new room and move both players)
  socket.on('requestReengage', (data) => {
    const { room, color } = data;
    console.log(`🤝 Player ${color} in room ${room} requested re-engage`);
    
    if (!rooms[room]) {
      console.log(`Room ${room} not found`);
      socket.emit('reengageCancelled', { reason: 'ROOM NOT FOUND' });
      return;
    }
    
    // Ensure structure
    if (!reengageStatus[room]) {
      reengageStatus[room] = { players: {}, timeout: null };
    }
    
    // Mark this player as requested re-engage
    reengageStatus[room].players[color] = true;
    
    console.log(`Re-engage status for room ${room}:`, reengageStatus[room].players);
    
    // Notify partner that this player is ready
    socket.to(room).emit('partnerReengaged', {
      color: color,
      message: `${color.toUpperCase()} player is ready to re-engage`
    });
    
    // Check if all players have requested re-engage
    const roomPlayers = Object.keys(rooms[room].players);
    const allRequested = roomPlayers.every(pc => reengageStatus[room].players[pc] === true);
    
    if (!allRequested) {
      // Set a wait timeout: if partner doesn't request within 30s cancel the flow
      if (reengageStatus[room].timeout) clearTimeout(reengageStatus[room].timeout);
      reengageStatus[room].timeout = setTimeout(() => {
        io.to(room).emit('reengageCancelled', { reason: 'PARTNER DID NOT RESPOND IN TIME' });
        if (reengageStatus[room] && reengageStatus[room].timeout) clearTimeout(reengageStatus[room].timeout);
        delete reengageStatus[room];
        console.log(new Date().toISOString(), `Re-engage aborted for room ${room} because partner did not request`);
      }, 30000);
      return;
    }

    // BOTH requested -> create a NEW room and move both players into it
    const newRoom = generateRoomCode();
    console.log(`Creating re-engage room ${newRoom} for previous room ${room}`);

    // Initialize new room data
    rooms[newRoom] = {
      players: {},
      gameSequence: [],
      currentRound: 0,
      roundCompleted: {},
      startTime: null,
      teamName: rooms[room].teamName || generateTeamName(),
      gameActive: false,
      currentSequence: 1,
      numberSequenceState: {},
      numberSequenceStarted: false,
      personalTimers: {
        yellow: GAME_CONSTANTS.PERSONAL_TIMER_START,
        blue: GAME_CONSTANTS.PERSONAL_TIMER_START,
        red: GAME_CONSTANTS.PERSONAL_TIMER_START,
        green: GAME_CONSTANTS.PERSONAL_TIMER_START
      },
      gameCompletionTracking: {
        yellow: false,
        blue: false,
        red: false,
        green: false
      },
      timerInterval: null
    };
    
    // Initialize mini-games mode trigger for re-engage room
    rooms[newRoom].inNumberSequence = false;
    rooms[newRoom].numberSequenceTrigger = null;
    rooms[newRoom].numberSequenceTimerInterval = null;
    rooms[newRoom].numberSequenceTimer = GAME_CONSTANTS.NUMBER_SEQUENCE_TIME;

    // Move both players into newRoom (copy usernames/socketIds), and join sockets to newRoom
    roomPlayers.forEach(pc => {
      const pd = rooms[room].players[pc];
      if (!pd) return;
      rooms[newRoom].players[pc] = { socketId: pd.socketId, username: pd.username };
      const playerSocket = io.sockets.sockets.get(pd.socketId);
      if (playerSocket) {
        try {
          playerSocket.join(newRoom);
          // Let the client know their new room + color (so UI can show the two pilots in the new room)
          playerSocket.emit('colorAssigned', {
            color: pc,
            players: Object.keys(rooms[newRoom].players).map(c => rooms[newRoom].players[c].username),
            teamName: rooms[newRoom].teamName,
            room: newRoom
          });
        } catch (err) {
          console.warn(`Could not join socket ${pd.socketId} to ${newRoom}:`, err);
        }
      }
    });

    // Optionally broadcastAvailableRooms() so lobby updates (new room may show up)
    broadcastAvailableRooms();

    // Mark game active and prepare the game sequence for the new room
    rooms[newRoom].gameSequence = generateGameSequence(rooms[newRoom].players);
    Object.keys(rooms[newRoom].players).forEach(c => { rooms[newRoom].roundCompleted[c] = false; });

    // Notify players in the new room that game is ready (this lets clients show the two pilots before countdown)
    const playersList = Object.keys(rooms[newRoom].players).map(c => rooms[newRoom].players[c].username);
    io.to(newRoom).emit('gameReady', { players: playersList });
    rooms[newRoom].gameActive = true;

    // Clear old re-engage tracking for the previous room
    if (reengageStatus[room] && reengageStatus[room].timeout) clearTimeout(reengageStatus[room].timeout);
    delete reengageStatus[room];

    // Start the new game after the normal join delay (13s = 10s mission + 3s confirmation)
    setTimeout(() => {
      if (!rooms[newRoom]) return;
      rooms[newRoom].startTime = Date.now();
      const firstRound = rooms[newRoom].gameSequence[0];
      const playerColors = Object.keys(rooms[newRoom].players);
      const gameAssignments = {};
      playerColors.forEach(pc => {
        const gt = firstRound[pc];
        gameAssignments[pc] = { gameType: gt, gameData: generateGameData(gt) };
      });

      io.to(newRoom).emit('startGame', {
        teamName: rooms[newRoom].teamName,
        players: rooms[newRoom].players,
        gameAssignments,
        round: 1,
        totalRounds: GAME_CONSTANTS.TOTAL_ROUNDS,
        startTime: rooms[newRoom].startTime,
        personalTimers: rooms[newRoom].personalTimers
      });

      // Start server-side authoritative timer countdown
      startServerTimerCountdown(newRoom);
      
      // Start random trigger for Number Sequence (60-90 seconds)
      startNumberSequenceTrigger(newRoom);

      console.log(`🎮 Started re-engaged game in room ${newRoom} - Round 1 assignments:`, gameAssignments);
    }, 13000);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeRooms: Object.keys(rooms).length,
    totalTeams: Object.keys(teamStats).length
  });
});

// Get stats endpoint
app.get('/stats', (req, res) => {
  const stats = {
    activeRooms: Object.keys(rooms).length,
    totalTeams: Object.keys(teamStats).length,
    recentGames: Object.entries(teamStats)
      .sort(([,a], [,b]) => new Date(b[b.length-1]?.date) - new Date(a[a.length-1]?.date))
      .slice(0, 10)
      .reduce((acc, [team, records]) => {
        acc[team] = records.slice(-3); // Last 3 games per team
        return acc;
      }, {})
  };
  res.json(stats);
});

// Debug endpoint to check room status
app.get('/debug/rooms', (req, res) => {
  const roomStatus = {};
  for (const room in rooms) {
    roomStatus[room] = {
      players: rooms[room].players,
      gameSequence: rooms[room].gameSequence,
      currentRound: rooms[room].currentRound,
      roundCompleted: rooms[room].roundCompleted,
      gameActive: rooms[room].gameActive,
      currentSequence: rooms[room].currentSequence,
      numberSequenceState: rooms[room].numberSequenceState
    };
  }
  res.json(roomStatus);
});

// Clean up empty rooms periodically
setInterval(() => {
  const roomCountBefore = Object.keys(rooms).length;
  for (const room in rooms) {
    if (Object.keys(rooms[room].players).length === 0) {
      stopServerTimerCountdown(room);  // Clean up timer interval
      if (rooms[room].numberSequenceTrigger) {
        clearTimeout(rooms[room].numberSequenceTrigger);
      }
      stopNumberSequenceTimer(room);  // Clean up Number Sequence timer
      delete rooms[room];
    }
  }
  const roomCountAfter = Object.keys(rooms).length;
  if (roomCountBefore !== roomCountAfter) {
    console.log(`Cleaned up ${roomCountBefore - roomCountAfter} empty rooms`);
  }
}, 30000); // Check every 30 seconds

server.listen(3000, () => {
  console.log('=========================================');
  console.log('U.S. NAVAL COOPERATION TEST SERVER');
  console.log('=========================================');
  console.log('Server running at http://localhost:3000');
  console.log('Active rooms:', Object.keys(rooms).length);
  console.log('Total teams in database:', Object.keys(teamStats).length);
  console.log('Awaiting naval recruits...');
  console.log('=========================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server gracefully...');
  console.log('Saving team stats...');
  saveTeamStats();
  console.log('Team stats saved.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nServer terminated gracefully');
  saveTeamStats();
  process.exit(0);
});