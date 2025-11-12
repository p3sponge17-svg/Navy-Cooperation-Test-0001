const socket = io();

// Game Constants
const GAME_CONSTANTS = {
  INITIAL_COUNTDOWN: 25,
  NUMBER_SEQUENCE_TIME: 24,
  TOTAL_ROUNDS: 3,
  MAX_NUMBERS: 12,
  MOUSE_EMIT_THROTTLE: 50,
  ROUND_TRANSITION_DELAY: 1500,
  GAME_OVER_RELOAD_DELAY: 5000
};

let color = null;
let room = null;  // Changed from 'default' to null for room code system
let username = null;
let timerInterval = null;
let countdownInterval = null;
let startTime = null;
// Personal timers for each player (replaced single countdown)
let personalTimers = {
  yellow: GAME_CONSTANTS.INITIAL_COUNTDOWN,
  blue: GAME_CONSTANTS.INITIAL_COUNTDOWN,
  red: GAME_CONSTANTS.INITIAL_COUNTDOWN,
  green: GAME_CONSTANTS.INITIAL_COUNTDOWN
};
let gameCountdownActive = false;  // Flag to indicate when actual game countdown has started
let partnerCursors = {};
let lastEmitTime = 0;
let ownCursor = null;
let myGameType = null;
let sectionIndex = null; // Which section I'm playing in (1 or 2)

// NEW: Lobby browser variables
let selectedRoomToJoin = null;
let availableRooms = [];
let isCreatingNewRoom = false;

// Number Sequence Game Variables
let numberSequenceTimer = GAME_CONSTANTS.NUMBER_SEQUENCE_TIME;  // Using constant instead of 24
let numberSequenceInterval = null;
let sequenceData = null;
let currentSequenceNumber = 1;

// Voice synthesis for countdown
const synth = window.speechSynthesis;
let countdownVoice = null;

// Color Match Game Variables
let cyclesSinceLastMatch = 0;
let colorMatchIntervals = {
  section1: { colorInterval: null, nameInterval: null, completed: false },
  section2: { colorInterval: null, nameInterval: null, completed: false },
  section3: { colorInterval: null, nameInterval: null, completed: false },
  section4: { colorInterval: null, nameInterval: null, completed: false }
};

// Re-engage with team variables
let reengageRequested = false;
let partnerReengaged = false;

// Helper function: Wait for game countdown to start, then execute after delay
function waitForCountdownThen(callback, delayMs = 4000) {
  if (gameCountdownActive) {
    // Countdown already started, just wait the delay
    setTimeout(callback, delayMs);
  } else {
    // Wait for countdown to start, then add the delay
    const listener = () => {
      setTimeout(callback, delayMs);
      window.removeEventListener('gameCountdownStarted', listener);
    };
    window.addEventListener('gameCountdownStarted', listener);
  }
}


// Initialize voice with improved error handling
function initializeVoice() {
  try {
    if (!synth) {
      console.warn('Speech synthesis not available');
      return;
    }
    
    const voices = synth.getVoices();
    if (voices.length === 0) {
      console.warn('No voices available yet');
      return;
    }
    
    countdownVoice = voices.find(voice => 
      voice.name.includes('Female') || 
      voice.name.includes('woman') ||
      voice.name.includes('Samantha') ||
      voice.name.includes('Victoria')
    );
    
    if (!countdownVoice) {
      countdownVoice = voices[0];
    }
    
    console.log('Voice initialized:', countdownVoice?.name || 'default');
  } catch (error) {
    console.warn('Error initializing voice:', error);
    countdownVoice = null;
  }
}

// NEW: Room code prompt function (kept for backward compatibility)
function promptForRoom() {
  const roomInput = prompt('ENTER ROOM CODE (or leave empty to create new room):');
  if (roomInput && roomInput.trim()) {
    return roomInput.trim().toUpperCase();
  }
  // Generate random 4-character code
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// NEW: Lobby Browser Functions

function showLobbyBrowser() {
  console.log('Showing lobby browser');
  selectedRoomToJoin = null;
  isCreatingNewRoom = false;
  showScreen('lobbyBrowser');
}

function backToLobby() {
  console.log('Going back to lobby');
  showLobbyBrowser();
}

function showCreateRoom() {
  console.log('Creating new room');
  isCreatingNewRoom = true;
  selectedRoomToJoin = null;
  room = Math.random().toString(36).substring(2, 6).toUpperCase(); // Generate random code
  
  // Hide room code input for new room creation
  const roomCodeInput = document.getElementById('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.style.display = 'none';
    roomCodeInput.value = '';
  }
  
  // Hide joining info
  const joiningInfo = document.getElementById('joiningRoomInfo');
  if (joiningInfo) {
    joiningInfo.style.display = 'none';
  }
  
  showScreen('usernameScreen');
  document.getElementById('usernameInput').focus();
}

function showPrivateRoomJoin() {
  console.log('Joining private room with code');
  isCreatingNewRoom = false;
  selectedRoomToJoin = null;
  
  // Show room code input for private room
  const roomCodeInput = document.getElementById('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.style.display = 'block';
    roomCodeInput.value = '';
  }
  
  // Hide joining info
  const joiningInfo = document.getElementById('joiningRoomInfo');
  if (joiningInfo) {
    joiningInfo.style.display = 'none';
  }
  
  showScreen('usernameScreen');
  document.getElementById('usernameInput').focus();
}

function joinRoom(roomCode, teamName, players) {
  console.log(`Joining room: ${roomCode}, team: ${teamName}`);
  selectedRoomToJoin = roomCode;
  room = roomCode;
  isCreatingNewRoom = false;
  
  // Show room code input (read-only) so player knows which room
  const roomCodeInput = document.getElementById('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.style.display = 'block';
    roomCodeInput.value = roomCode;
    roomCodeInput.readOnly = true;
  }
  
  // Show joining room info
  const joiningInfo = document.getElementById('joiningRoomInfo');
  const joiningTeamName = document.getElementById('joiningTeamName');
  const joiningPlayersList = document.getElementById('joiningPlayersList');
  
  if (joiningInfo && joiningTeamName && joiningPlayersList) {
    joiningInfo.style.display = 'block';
    joiningTeamName.textContent = teamName;
    
    // Show players already in room
    let playersHTML = '';
    players.forEach(player => {
      playersHTML += `
        <div class="joining-player">
          <span class="joining-player-color ${player.color}">${player.color.toUpperCase()}</span>
          <span class="joining-player-name">${player.username}</span>
        </div>
      `;
    });
    joiningPlayersList.innerHTML = playersHTML;
  }
  
  showScreen('usernameScreen');
  document.getElementById('usernameInput').focus();
}

// Lobby Management - UPDATED
function submitUsername() {
  console.log('submitUsername called');
  
  const usernameInput = document.getElementById('usernameInput');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const name = usernameInput.value.trim();
  
  console.log('Username entered:', name);
  
  if (name.length < 2) {
    alert('CALL SIGN MUST BE AT LEAST 2 CHARACTERS');
    return;
  }
  
  username = name.toUpperCase();
  
  // Determine room based on context
  if (selectedRoomToJoin) {
    // Joining existing room from lobby browser
    room = selectedRoomToJoin;
  } else if (isCreatingNewRoom) {
    // Creating new room - room code already set
    // room variable already set in showCreateRoom()
  } else {
    // Private room code entered manually
    const roomCodeEntered = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : '';
    if (roomCodeEntered && roomCodeEntered.length > 0) {
      room = roomCodeEntered;
    } else {
      // No room specified - generate new one
      room = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
  }
  
  console.log(`Joining room: ${room} as ${username}`);
  console.log('Socket connected:', socket.connected);
  
  socket.emit('joinRoom', { room, username });
  console.log('joinRoom event emitted');
}

function showScreen(screenId) {
  console.log(`Showing screen: ${screenId}`);
  
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  document.querySelectorAll('.lobby-section').forEach(section => {
    section.classList.remove('active');
  });
  
  if (screenId === 'gameScreen' || screenId === 'numberSequenceScreen') {
    document.getElementById(screenId).classList.add('active');
  } else {
    document.getElementById('lobbyScreen').classList.add('active');
    document.getElementById(screenId).classList.add('active');
  }
}

function showColorConfirmation() {
  showScreen('colorConfirmationScreen');
  
  const confirmedColorElement = document.getElementById('confirmedColor');
  confirmedColorElement.textContent = color;
  confirmedColorElement.className = color;
  
  // Show confirmation for 3 seconds, then switch to 4-player countdown grid
  setTimeout(() => {
    showFourPlayerCountdown();
    startFourPlayerGridCountdown();
  }, 3000);
}

// NEW: Render available rooms in lobby browser
function renderAvailableRooms(rooms) {
  console.log('Rendering available rooms:', rooms);
  availableRooms = rooms;
  
  const roomsList = document.getElementById('availableRoomsList');
  if (!roomsList) {
    console.error('availableRoomsList element not found');
    return;
  }
  
  if (!rooms || rooms.length === 0) {
    // No rooms available
    roomsList.innerHTML = `
      <div class="no-rooms-message">
        <div class="scanning-icon">🛰️</div>
        <p>NO ACTIVE MISSIONS FOUND</p>
        <p class="no-rooms-subtext">Be the first pilot! Create a new mission below.</p>
      </div>
    `;
    return;
  }
  
  // Rooms available - render them
  let roomsHTML = '';
  rooms.forEach(roomData => {
    const playersHTML = roomData.players.map(player => `
      <div class="room-player">
        <span class="room-player-color ${player.color}">${player.color.toUpperCase()}</span>
        <span class="room-player-name">${player.username}</span>
      </div>
    `).join('');
    
    roomsHTML += `
      <div class="room-card" data-room-code="${roomData.roomCode}">
        <div class="room-header">
          <div class="room-icon">🎮</div>
          <div class="room-team-name">${roomData.teamName}</div>
        </div>
        <div class="room-status">
          <span class="room-player-count">${roomData.playerCount}/${roomData.maxPlayers} PILOTS</span>
          <span class="room-spots-left">${roomData.spotsLeft} SPOT${roomData.spotsLeft > 1 ? 'S' : ''} OPEN</span>
        </div>
        <div class="room-players">
          ${playersHTML}
        </div>
        <div class="room-code-display">
          <span class="room-code-label">ROOM CODE:</span>
          <span class="room-code-value">${roomData.roomCode}</span>
        </div>
        <button onclick="joinRoom('${roomData.roomCode}', '${roomData.teamName}', ${JSON.stringify(roomData.players).replace(/"/g, '&quot;')})" class="join-room-btn">
          JOIN MISSION →
        </button>
      </div>
    `;
  });
  
  roomsList.innerHTML = roomsHTML;
}

function startMissionCountdown() {
  // This function is kept for compatibility but now just calls the 4-player countdown
  showFourPlayerCountdown();
  startFourPlayerGridCountdown();
}

// NEW: Show the 4-player grid countdown screen
function showFourPlayerCountdown() {
  console.log('Showing 4-player grid countdown');
  showScreen('fourPlayerCountdownScreen');
  
  // Request player data for all 4 players in the room
  socket.emit('requestPlayersData', { room });
}

// NEW: Start the 10-second countdown on the 4-player grid
function startFourPlayerGridCountdown() {
  console.log('Starting 4-player grid 10-second countdown');
  
  let countdownTime = 10;
  
  // Initialize the display at 10
  updateFourPlayerCountdownTimerDisplay(countdownTime);
  speakCountdown(countdownTime);
  
  // Use setInterval to count down every second
  const countdown = setInterval(() => {
    countdownTime--;
    
    // Update the display
    updateFourPlayerCountdownTimerDisplay(countdownTime);
    
    // Speak the countdown (but not at 0)
    if (countdownTime > 0) {
      speakCountdown(countdownTime);
    }
    
    // When countdown reaches 0, start the game
    if (countdownTime <= 0) {
      clearInterval(countdown);
      // Small delay to ensure user sees "0"
      setTimeout(() => {
        showScreen('gameScreen');
        startCountdown(); // Start game countdown AFTER screen is visible
      }, 500);
    }
  }, 1000);
}

// NEW: Update the 4-player countdown timer display
function updateFourPlayerCountdownTimerDisplay(timeRemaining) {
  const timerElement = document.getElementById('fourPlayerCountdownTimer');
  if (timerElement) {
    // Format as MM:SS (for times under 1 minute, will show 00:SS)
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    // Simple format: just show the seconds with leading zero
    timerElement.textContent = `00:00:${seconds.toString().padStart(2, '0')}`;
  }
}

// NEW: Show the center display as a stopwatch when game starts
function showGameStopwatch() {
  const centerDisplay = document.getElementById('gameCenterDisplay');
  if (centerDisplay) {
    centerDisplay.style.display = 'block';
    
    // Start updating the stopwatch
    updateGameStopwatch();
  }
}

// NEW: Update the stopwatch in the center
function updateGameStopwatch() {
  const timerElement = document.getElementById('gameStopwatchTimer');
  if (!timerElement) return;
  
  const updateTime = () => {
    if (!startTime) return;
    
    const elapsed = (Date.now() - startTime) / 1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    const milliseconds = Math.floor((elapsed % 1) * 100);
    
    timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(2, '0')}`;
    
    // Only continue if game is active
    if (document.getElementById('gameScreen').classList.contains('active')) {
      requestAnimationFrame(updateTime);
    }
  };
  
  updateTime();
}

// NEW: Populate the 4-player grid with player data
function populateFourPlayerGrid(playersData) {
  console.log('Populating 4-player grid with data:', playersData);
  
  // Colors in order: yellow (top-left), blue (top-right), red (bottom-left), green (bottom-right)
  const colorOrder = ['yellow', 'blue', 'red', 'green'];
  
  colorOrder.forEach(playerColor => {
    const playerData = playersData[playerColor];
    const nameElement = document.getElementById(`name-${playerColor}`);
    const ipElement = document.getElementById(`ip-${playerColor}`);
    
    if (playerData && nameElement && ipElement) {
      // Show "YOU" for the current player, otherwise show their username
      nameElement.textContent = playerColor === color ? 'YOU' : playerData.username;
      
      // Add special styling for "YOU"
      if (playerColor === color) {
        nameElement.classList.add('is-you');
      }
      
      // Generate a fake IP address (or use real one if available)
      ipElement.textContent = playerData.ip || generateFakeIP();
    }
  });
  
  // Update the countdown timer
  updateFourPlayerCountdownTimer();
}

// NEW: Update the 4-player countdown timer
function updateFourPlayerCountdownTimer() {
  const timerElement = document.getElementById('fourPlayerCountdownTimer');
  
  const updateTimer = () => {
    const currentTime = Date.now();
    const elapsed = Math.floor((currentTime - fourPlayerCountdownStartTime) / 1000);
    const remaining = Math.max(0, 5 - elapsed);
    
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    
    timerElement.textContent = `00:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (remaining > 0) {
      requestAnimationFrame(updateTimer);
    }
  };
  
  fourPlayerCountdownStartTime = Date.now();
  updateTimer();
}

// Helper function to generate a fake IP address
function generateFakeIP() {
  const part1 = Math.floor(Math.random() * 256);
  const part2 = Math.floor(Math.random() * 256);
  return `${part1}.${part2}.XXX.XXX`;
}

let fourPlayerCountdownStartTime = null;

function speakCountdown(number) {
  try {
    if (!synth || synth.speaking) {
      synth?.cancel();
    }
    
    if (!countdownVoice) {
      console.log('Voice not available, skipping speech');
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(number.toString());
    utterance.voice = countdownVoice;
    utterance.rate = 0.8;
    utterance.pitch = 1.2;
    synth.speak(utterance);
  } catch (error) {
    console.warn('Could not speak countdown:', error);
  }
}

function applyPlayerColorsToSections(players) {
  console.log('Applying player colors to sections:', players);
  
  const playerColors = Object.keys(players);
  
  // Apply colors to all 4 sections
  for (let i = 0; i < 4; i++) {
    if (playerColors[i]) {
      const section = document.getElementById(`section${i + 1}`);
      section.classList.remove('player-red', 'player-blue', 'player-green', 'player-yellow');
      section.classList.add(`player-${playerColors[i]}`);
    }
  }
  
  // Apply current player's color to game screen
  const gameScreen = document.getElementById('gameScreen');
  if (gameScreen) {
    gameScreen.classList.remove('player-red', 'player-blue', 'player-green', 'player-yellow');
    gameScreen.classList.add(`player-${color}`);
  }
  
  const numberSequenceScreen = document.getElementById('numberSequenceScreen');
  if (numberSequenceScreen) {
    numberSequenceScreen.classList.remove('player-red', 'player-blue', 'player-green', 'player-yellow');
    numberSequenceScreen.classList.add(`player-${color}`);
  }
}

// NEW FUNCTION: Update cursor with assigned color
function updateCursorWithAssignedColor() {
  if (!color) return;
  
  // Remove existing cursor if it exists
  if (ownCursor) {
    ownCursor.remove();
    ownCursor = null;
  }
  
  // Create new cursor with assigned color
  ownCursor = document.createElement('div');
  ownCursor.id = 'own-cursor';
  ownCursor.className = `own-cursor ${color}`;
  ownCursor.style.position = 'fixed';
  ownCursor.style.width = '28px';
  ownCursor.style.height = '28px';
  ownCursor.style.pointerEvents = 'none';
  ownCursor.style.zIndex = '10000';
  ownCursor.style.transition = 'transform 0.1s ease';
  
  // Use player's assigned color for the arrow
  const arrowSvg = `
    <svg width="28" height="28" viewBox="0 0 28 28">
      <path d="M14 2 L26 26 L14 18 L2 26 Z" fill="${getColorHex(color)}" stroke="#000" stroke-width="1"/>
    </svg>
  `;
  ownCursor.innerHTML = arrowSvg;
  
  document.body.appendChild(ownCursor);
  document.body.style.cursor = 'none';
  
  // Update cursor position with current mouse position
  document.addEventListener('mousemove', updateOwnCursorPosition);
}

// UPDATED FUNCTION: More efficient cursor creation
function createOwnCursor() {
  // If we already have a cursor with the correct color, just ensure it's visible
  if (ownCursor && ownCursor.className.includes(color)) {
    return; // Cursor already exists with correct color
  }
  
  // Otherwise create/update the cursor
  updateCursorWithAssignedColor();
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  removeOwnCursor();
});

// NEW: Listen for lobby updates (available rooms list)
socket.on('lobbyUpdate', (data) => {
  console.log('📡 Lobby update received:', data);
  renderAvailableRooms(data.rooms);
});

socket.on('colorAssigned', (data) => {
  console.log('Color assigned:', data);
  color = data.color;
  
  console.log('Showing color screen with color:', color);
  showScreen('colorScreen');
  
  const colorElement = document.getElementById('assignedColor');
  if (colorElement) {
    colorElement.textContent = color.toUpperCase();
    colorElement.className = color;
    console.log('Color element updated');
  } else {
    console.error('assignedColor element not found!');
  }
  
  
  // Update waiting players list - show current players in room
  const playersWaitingList = document.getElementById('playersWaitingList');
  console.log('Updating players list on colorAssigned. Players:', data.players);
  console.log('Player colors:', data.playerColors);
  console.log('Current username:', username);
  console.log('Player color:', color);
  
  if (playersWaitingList && username) {
    let playersHTML = '';
    
    // If data includes existing players in room, show them all
    if (data.players && Array.isArray(data.players)) {
      console.log('Building HTML for', data.players.length, 'player(s)');
      
      data.players.forEach((player, index) => {
        const isSelf = player === username;
        const playerColor = data.playerColors ? data.playerColors[player] : null;
        console.log(`  Player ${index + 1}: ${player} (isSelf: ${isSelf}, color: ${playerColor})`);
        
        let displayText = player;
        let cssClass = 'player-indicator pulsing';
        
        if (isSelf) {
          displayText = `${player} (YOU)`;
          cssClass = `player-indicator pulsing self ${color}`; // Add color class
        } else {
          // Show other player's name with their color
          if (playerColor) {
            displayText = `${player} (${playerColor.toUpperCase()})`;
          }
          cssClass = 'player-indicator partner pulsing';
        }
        
        playersHTML += `<span class="${cssClass}">${displayText}</span>`;
      });
    } else {
      // Fallback if no players array provided
      playersHTML = `<span class="player-indicator pulsing self ${color}">${username} (YOU)</span>`;
    }
    
    console.log('Setting playersWaitingList innerHTML:', playersHTML);
    playersWaitingList.innerHTML = playersHTML;
  } else {
    console.error('Could not update players list:', {
      playersWaitingList: !!playersWaitingList,
      username: username
    });
  }
  
  // UPDATE: Create cursor with assigned color immediately
  updateCursorWithAssignedColor();
});

// Listen for when a new player joins the room (REAL-TIME UPDATE)
socket.on('playerJoined', (data) => {
  console.log('🎮 REAL-TIME UPDATE: New player joined room!', data);
  console.log('  New player:', data.username);
  console.log('  New player color:', data.color);
  console.log('  All players now:', data.players);
  console.log('  Current username:', username);
  console.log('  Is this player me?', data.username === username);
  
  // Update the waiting players list to include the new player
  const playersWaitingList = document.getElementById('playersWaitingList');
  console.log('  playersWaitingList element:', playersWaitingList);
  
  if (playersWaitingList && data.players && Array.isArray(data.players)) {
    console.log('  Updating players list with', data.players.length, 'players');
    console.log('  Player colors:', data.playerColors);
    let playersHTML = '';
    
    data.players.forEach((player, index) => {
      const isSelf = player === username;
      const isNewPlayer = player === data.username;
      const playerColor = data.playerColors ? data.playerColors[player] : null;
      
      console.log(`    Player ${index + 1}: ${player} (isSelf: ${isSelf}, isNew: ${isNewPlayer}, color: ${playerColor})`);
      
      // Build display with color indicators
      let displayText = player;
      let cssClass = 'player-indicator pulsing';
      
      if (isSelf) {
        displayText = `${player} (YOU)`;
        cssClass = `player-indicator pulsing self ${color}`; // Add color class
      } else {
        // Show other player's name with their color
        if (playerColor) {
          displayText = `${player} (${playerColor.toUpperCase()})`;
        }
        cssClass = 'player-indicator partner pulsing';
        if (isNewPlayer) {
          cssClass += ' new-player-joined';
        }
      }
      
      playersHTML += `<span class="${cssClass}">${displayText}</span>`;
    });
    
    console.log('  Setting innerHTML:', playersHTML);
    playersWaitingList.innerHTML = playersHTML;
    
    // Show prominent notification that partner joined
    const waitingMessage = document.querySelector('#colorScreen p');
    console.log('  waitingMessage element:', waitingMessage);
    console.log('  Is new player me?', data.username === username);
    
    if (waitingMessage && data.username !== username) {
      console.log('  🎉 Showing join notification for:', data.username);
      waitingMessage.textContent = `🎯 ${data.color.toUpperCase()} PILOT "${data.username}" HAS JOINED THE MISSION!`;
      waitingMessage.style.color = '#00ff88';
      waitingMessage.style.fontSize = '1.5rem'; // Reduced from 2rem
      waitingMessage.style.fontWeight = '700';
      waitingMessage.style.textShadow = '0 0 20px rgba(0, 255, 136, 0.8)';
      waitingMessage.style.animation = 'pulse 0.5s ease-in-out 3';
      
      // Reset message after 3 seconds
      setTimeout(() => {
        if (data.players.length < 2) {
          waitingMessage.textContent = 'WAITING FOR OTHER PLAYERS TO JOIN';
          waitingMessage.style.color = '#00ff00';
          waitingMessage.style.fontSize = '1.5rem'; // Consistent size
          waitingMessage.style.fontWeight = '400';
        }
      }, 3000);
    } else {
      console.log('  Skipping notification - either element not found or this is me joining');
    }
  } else {
    console.log('  ❌ Could not update players list:');
    console.log('    playersWaitingList exists:', !!playersWaitingList);
    console.log('    data.players exists:', !!data.players);
    console.log('    data.players is array:', Array.isArray(data.players));
  }
});

socket.on('roomFull', () => {
  console.log('Room is full!');
  alert('ROOM IS FULL! Please try again or join a different room.');
  location.reload();
});

// NEW: Handle room preview responses
socket.on('roomPreview', (data) => {
  console.log('📡 Room preview data received:', data);
  
  const previewArea = document.getElementById('roomPreview');
  if (!previewArea) {
    console.log('⚠️ roomPreview element not found');
    return;
  }
  
  if (data.exists && data.players && data.players.length > 0) {
    // Room exists with players
    const playerCount = data.players.length;
    const spotsLeft = 2 - playerCount;
    
    console.log(`Room has ${playerCount} player(s), ${spotsLeft} spot(s) available`);
    
    let playersHTML = '';
    data.players.forEach((player, index) => {
      const colorName = player.color.toUpperCase();
      playersHTML += `
        <div class="preview-player">
          <span class="preview-player-color ${player.color}">${colorName}</span>
          <span class="preview-player-name">${player.username}</span>
        </div>
      `;
    });
    
    const statusClass = spotsLeft > 0 ? 'available' : 'full';
    const statusText = spotsLeft > 0 ? `${spotsLeft} SPOT${spotsLeft > 1 ? 'S' : ''} AVAILABLE` : 'ROOM FULL';
    
    previewArea.innerHTML = `
      <div class="room-preview-content ${statusClass}">
        <div class="preview-header">
          <div class="preview-icon">🎮</div>
          <div class="preview-room-code">ROOM: ${data.room}</div>
        </div>
        <div class="preview-status">${statusText}</div>
        <div class="preview-players-list">
          ${playersHTML}
        </div>
        ${spotsLeft > 0 ? '<div class="preview-action">✅ Ready to join! Enter your call sign above ⬆️</div>' : '<div class="preview-action warning">⚠️ Room is full - try another code</div>'}
      </div>
    `;
    previewArea.style.display = 'block';
  } else if (data.exists && data.players.length === 0) {
    // Room exists but empty
    console.log('Room exists but is empty');
    previewArea.innerHTML = `
      <div class="room-preview-content empty">
        <div class="preview-icon">🆕</div>
        <div class="preview-text">ROOM: ${data.room}</div>
        <div class="preview-subtext">This room is empty. You'll be the first pilot!</div>
      </div>
    `;
    previewArea.style.display = 'block';
  } else {
    // Room doesn't exist yet - will be created
    console.log('Room does not exist - will be created');
    previewArea.innerHTML = `
      <div class="room-preview-content new">
        <div class="preview-icon">✨</div>
        <div class="preview-text">CREATE NEW ROOM: ${data.room}</div>
        <div class="preview-subtext">You'll create this room and wait for a partner</div>
      </div>
    `;
    previewArea.style.display = 'block';
  }
});


socket.on('gameReady', (data) => {
  console.log('Game ready - all players connected', data);
  
  // Update the waiting message
  const waitingMessage = document.getElementById('waitingMessage');
  if (waitingMessage) {
    waitingMessage.textContent = 'ALL PILOTS CONNECTED! PREPARE FOR MISSION...';
    waitingMessage.style.color = '#00ff00';
  }
  
  // Update waiting players list to show all players
  const playersWaitingList = document.getElementById('playersWaitingList');
  if (playersWaitingList) {
    let playersHTML = '';
    
    // If server sends player data, use it
    if (data && data.players && Array.isArray(data.players)) {
      data.players.forEach(player => {
        const isSelf = player === username;
        const cssClass = isSelf ? 'player-indicator' : 'player-indicator partner pulsing';
        playersHTML += `<span class="${cssClass}">${player}</span>`;
      });
      playersWaitingList.innerHTML = playersHTML;
    } else if (username) {
      // Fallback: show generic message if no player data
      playersWaitingList.innerHTML = `
        <span class="player-indicator">${username}</span>
        <span class="player-indicator partner pulsing">PARTNERS CONNECTED</span>
      `;
    }
  }
  
  // Hide pulse dots
  const pulseDots = document.querySelector('.pulse-dots');
  if (pulseDots) {
    pulseDots.style.display = 'none';
  }
  
  // Show confirmation after 4 second delay to display all players
  setTimeout(() => {
    showColorConfirmation();
  }, 4000);
});

socket.on('startGame', (data) => {
  console.log('Game started!', data);
  
  // Initialize personal timers from server
  if (data.personalTimers) {
    personalTimers = { ...data.personalTimers };
    console.log('Personal timers initialized:', personalTimers);
  }
  
  startTime = Date.now();
  updateTimer();
  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 100);

  // Update round indicator
  document.getElementById('roundIndicator').textContent = `ROUND ${data.round} OF ${data.totalRounds}`;

  applyPlayerColorsToSections(data.players);

  // Load games for ALL sections based on assignments (now 4 players)
  const playerColors = Object.keys(data.players);
  
  // Determine which section belongs to me
  sectionIndex = playerColors.indexOf(color) + 1;
  console.log(`I am ${color}, playing in section ${sectionIndex}`);
  
  // Load all games (now 4 players)
  playerColors.forEach((playerColor, index) => {
    const assignment = data.gameAssignments[playerColor];
    loadGameInSection(index + 1, assignment.gameType, assignment.gameData, playerColor);
  });
  
  createOwnCursor();
});

// NEW: Socket handler for players data (for 4-player grid)
socket.on('playersData', (data) => {
  console.log('Received players data:', data);
  populateFourPlayerGrid(data.players);
});

// NEW: Socket handler for timer updates (bonuses/penalties)
socket.on('timerUpdate', (data) => {
  console.log('Timer update received:', data.personalTimers);
  if (data.personalTimers) {
    personalTimers = { ...data.personalTimers };
    updateCountdownDots();
  }
});

// NEW: Socket handler for when a player's timer expires
socket.on('playerTimerExpired', (data) => {
  console.log(`Player ${data.color}'s timer expired!`, data);
  stopAllTimers();
  personalTimers = { ...data.personalTimers };
  updateCountdownDots();
  
  // Show game over screen
  // We'll implement proper end game logic in later phases
  setTimeout(() => {
    alert(`Player ${data.color.toUpperCase()}'s timer expired! Game Over!`);
  }, 500);
});

socket.on('nextRound', (data) => {
  console.log('Loading next round:', data);
  
  // Update personal timers from server
  if (data.personalTimers) {
    personalTimers = { ...data.personalTimers };
    console.log('Personal timers updated for next round:', personalTimers);
  }
  
  // IMPORTANT: Clear timer interval but keep countdown running
  clearInterval(timerInterval);
  timerInterval = null;
  // DON'T clear countdownInterval - timers persist across rounds
  
  // Update round indicator
  document.getElementById('roundIndicator').textContent = `ROUND ${data.round} OF ${data.totalRounds}`;
  
  // Get player colors
  const playerColors = Object.keys(data.gameAssignments);
  
  // Load games for both sections
  playerColors.forEach((playerColor, index) => {
    const assignment = data.gameAssignments[playerColor];
    loadGameInSection(index + 1, assignment.gameType, assignment.gameData, playerColor);
  });
  
  // Personal timers continue - no reset needed
  console.log('Next round loaded - personal timers continuing:', personalTimers);
});

socket.on('startNumberSequence', (data) => {
  console.log('=== STARTING NUMBER SEQUENCE ===');
  console.log('Received startNumberSequence event from server:', data);
  console.log('Current countdown value:', countdown);
  console.log('Timer interval active:', timerInterval !== null);
  console.log('Countdown interval active:', countdownInterval !== null);
  
  stopFirstGameTimer();
  
  console.log('After stop - Timer interval:', timerInterval);
  console.log('After stop - Countdown interval:', countdownInterval);
  console.log('==============================');
  
  sequenceData = data.sequenceData;
  currentSequenceNumber = 1;
  
  console.log('Sequence data:', sequenceData);
  console.log('Position data:', data.positions);
  
  showNumberSequenceScreen();
  applyPlayerColorsToSections(data.players);
  setupNumberSequenceGame(data.sequenceData, data.positions);
  
  setTimeout(() => {
    startNumberSequenceTimer();
  }, 500);
});

socket.on('numberSequenceCorrect', (data) => {
  console.log('Correct number sequence click:', data);
  
  if (data.addedTime) {
    numberSequenceTimer = Math.min(GAME_CONSTANTS.NUMBER_SEQUENCE_TIME, numberSequenceTimer + 2);
    updateNumberSequenceTimer();
  }
  
  currentSequenceNumber = data.nextNumber;
  
  const statusElement = document.getElementById('numberSequenceStatus');
  if (currentSequenceNumber <= GAME_CONSTANTS.MAX_NUMBERS) {
    statusElement.textContent = `NEXT: NUMBER ${currentSequenceNumber}`;
    statusElement.style.color = '';
  } else {
    statusElement.textContent = 'SEQUENCE COMPLETED!';
    statusElement.style.color = '#00ff00';
  }
  
  const numberElement = document.querySelector(`.number-circle[data-number="${data.number}"]`);
  if (numberElement) {
    numberElement.classList.add('correct');
    setTimeout(() => {
      numberElement.remove();
    }, 500);
  }
});

socket.on('numberSequenceIncorrect', (data) => {
  console.log('Incorrect number sequence click:', data);
  
  const statusElement = document.getElementById('numberSequenceStatus');
  statusElement.textContent = `WRONG! CLICK NUMBER ${currentSequenceNumber}`;
  statusElement.style.color = '#ff4444';
  
  const numberElement = document.querySelector(`.number-circle[data-number="${data.number}"]`);
  if (numberElement) {
    numberElement.classList.add('wrong');
    setTimeout(() => {
      numberElement.classList.remove('wrong');
    }, 500);
  }
  
  setTimeout(() => {
    statusElement.style.color = '';
  }, 1000);
});

socket.on('numberSequenceCompleted', () => {
  console.log('Number sequence game completed!');
  clearInterval(numberSequenceInterval);
  
  const statusElement = document.getElementById('numberSequenceStatus');
  statusElement.textContent = 'SEQUENCE COMPLETED! CALCULATING RESULTS...';
  statusElement.style.color = '#00ff00';
});

// Load game into specific section
function loadGameInSection(section, gameType, gameData, playerColor) {
  console.log(`Loading ${gameType} into section ${section} for player ${playerColor}`);
  
  const isMySection = (section === sectionIndex);
  
  // Get section elements
  const gameTitle = document.getElementById(`gameTitle${section}`);
  const grid = document.getElementById(`grid${section}`);
  const colorMatchGame = document.getElementById(`colorMatchGame${section}`);
  const statusMessage = document.getElementById(`statusMessage${section}`);
  
  // Clear previous game
  grid.innerHTML = '';
  colorMatchGame.innerHTML = '';
  
  // CRITICAL: Reset completion flags for this section to prevent "already completed" bug
  const sectionKey = `section${section}`;
  colorMatchIntervals[sectionKey].completed = false;
  
  // Clear any lingering intervals from previous games
  if (colorMatchIntervals[sectionKey].colorInterval) {
    clearInterval(colorMatchIntervals[sectionKey].colorInterval);
    colorMatchIntervals[sectionKey].colorInterval = null;
  }
  if (colorMatchIntervals[sectionKey].nameInterval) {
    clearInterval(colorMatchIntervals[sectionKey].nameInterval);
    colorMatchIntervals[sectionKey].nameInterval = null;
  }
  
  // Set title based on game type
  switch(gameType) {
    case 'findSix':
      gameTitle.textContent = 'FIND THE 6S';
      grid.style.display = 'grid';
      colorMatchGame.style.display = 'none';
      // Always set up the game, but only make it interactive for the owner
      setupFindSix(section, gameData.grid, isMySection);
      break;
    case 'findNine':
      gameTitle.textContent = 'FIND THE 9S';
      grid.style.display = 'grid';
      colorMatchGame.style.display = 'none';
      // Always set up the game, but only make it interactive for the owner
      setupFindNine(section, gameData.grid, isMySection);
      break;
    case 'colorMatch':
      gameTitle.textContent = 'COLOR MATCH';
      grid.style.display = 'none';
      colorMatchGame.style.display = 'flex';
      // Always set up the game, but only make it interactive for the owner
      setupColorMatch(section, isMySection);
      break;
    case 'shapeMemory':
      gameTitle.textContent = 'SHAPE MEMORY';
      grid.style.display = 'none';
      colorMatchGame.style.display = 'flex';
      // Always set up the game, but only make it interactive for the owner
      setupShapeMemory(section, isMySection);
      break;
    case 'memoryChallenge':
      gameTitle.textContent = 'MEMORY CHALLENGE';
      grid.style.display = 'none';
      colorMatchGame.style.display = 'flex';
      // Always set up the game, but only make it interactive for the owner
      setupMemoryChallenge(section, isMySection);
      break;
  }
  
  // Store current game type if this is my section
  if (isMySection) {
    myGameType = gameType;
  }
}

// Display grid (for partner's section - view only)
function displayGrid(section, grid) {
  const gridContainer = document.getElementById(`grid${section}`);
  gridContainer.style.gridTemplateColumns = 'repeat(8, 55px)';
  gridContainer.style.gridTemplateRows = 'repeat(3, 55px)';
  
  grid.forEach((num) => {
    const cell = document.createElement('div');
    cell.textContent = num;
    cell.style.pointerEvents = 'none';
    cell.style.opacity = '0.7';
    gridContainer.appendChild(cell);
  });
}

function displayColorMatchPlaceholder(section) {
  const container = document.getElementById(`colorMatchGame${section}`);
  container.innerHTML = '<div style="font-size: 1.5rem; padding: 40px;">PARTNER\'S COLOR MATCH</div>';
}

function displayShapeMemoryPlaceholder(section) {
  const container = document.getElementById(`colorMatchGame${section}`);
  container.innerHTML = '<div style="font-size: 1.5rem; padding: 40px;">PARTNER\'S SHAPE MEMORY</div>';
}

function displayMemoryChallengePlaceholder(section) {
  const container = document.getElementById(`colorMatchGame${section}`);
  container.innerHTML = '<div style="font-size: 1.5rem; padding: 40px;">PARTNER\'S MEMORY CHALLENGE</div>';
}

function getColorHex(colorName) {
  const colors = {
    red: '#ff4444',
    blue: '#4444ff',
    green: '#44aa44',
    yellow: '#ffaa00'
  };
  return colors[colorName] || '#00ff00';
}

function updateOwnCursorPosition(e) {
  if (ownCursor) {
    ownCursor.style.left = `${e.clientX - 14}px`;
    ownCursor.style.top = `${e.clientY - 14}px`;
  }
}

function removeOwnCursor() {
  if (ownCursor) {
    ownCursor.remove();
    ownCursor = null;
  }
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', updateOwnCursorPosition);
}

// NEW: Apply partner's game actions to their visual section
function applyPartnerAction(section, actionData) {
  const { gameType, actionType, data } = actionData;
  
  switch(gameType) {
    case 'findSix':
    case 'findNine':
      if (actionType === 'cellClick') {
        highlightPartnerCell(section, data.index, data.success);
      }
      break;
      
    case 'colorMatch':
      if (actionType === 'colorClick') {
        updatePartnerColorMatch(section, data.wasCorrect);
      }
      break;
      
    case 'shapeMemory':
      if (actionType === 'shapeClick') {
        highlightPartnerShape(section, data.shapeIndex);
      }
      break;
      
    case 'memoryChallenge':
      if (actionType === 'memoryClick') {
        updatePartnerMemoryChallenge(section, data);
      }
      break;
  }
}

// Helper: Highlight a cell in partner's grid
function highlightPartnerCell(section, cellIndex, success) {
  const gridContainer = document.getElementById(`grid${section}`);
  if (!gridContainer) return;
  
  const cells = gridContainer.children;
  if (cellIndex >= cells.length) return;
  
  const cell = cells[cellIndex];
  
  if (success) {
    // Partner found a correct number
    cell.style.color = '#00ff00';
    cell.style.textShadow = '0 0 15px #00ff00';
    cell.dataset.found = 'true';
  } else {
    // Partner clicked wrong number
    cell.style.color = '#ff4444';
    cell.style.textShadow = '0 0 15px #ff4444';
    setTimeout(() => {
      cell.style.color = '#ffffff';
      cell.style.textShadow = '0 0 15px #ffffff, 0 0 25px #ffffff';
    }, 500);
  }
}

// Helper: Update partner's color match display
function updatePartnerColorMatch(section, wasCorrect) {
  const statusMessage = document.getElementById(`statusMessage${section}`);
  if (!statusMessage) return;
  
  if (wasCorrect) {
    // Partner completed! Stop the color cycling intervals
    const sectionKey = `section${section}`;
    const intervals = colorMatchIntervals[sectionKey];
    
    if (intervals.colorInterval) {
      clearInterval(intervals.colorInterval);
      intervals.colorInterval = null;
    }
    if (intervals.nameInterval) {
      clearInterval(intervals.nameInterval);
      intervals.nameInterval = null;
    }
    
    // Set completed flag
    intervals.completed = true;
    
    // Show completion message
    statusMessage.textContent = 'PARTNER COMPLETED!';
    statusMessage.style.color = '#00ff00';
    
    // Optional: Highlight the color circle to show completion
    const colorCircle = document.querySelector(`#colorMatchGame${section} .colorCircle`);
    if (colorCircle) {
      colorCircle.style.border = '3px solid #00ff00';
      colorCircle.style.boxShadow = '0 0 25px #00ff00';
    }
  } else {
    statusMessage.textContent = 'PARTNER: TRYING...';
    statusMessage.style.color = '#ffaa00';
    
    setTimeout(() => {
      statusMessage.textContent = 'PARTNER\'S GAME';
      statusMessage.style.color = '#00ff00';
    }, 1000);
  }
}

// Helper: Highlight partner's shape selection
function highlightPartnerShape(section, shapeIndex) {
  const container = document.getElementById(`colorMatchGame${section}`);
  if (!container) return;
  
  const shapes = container.querySelectorAll('.shape-option');
  if (shapeIndex < shapes.length) {
    const shape = shapes[shapeIndex];
    shape.style.transform = 'scale(1.2)';
    shape.style.borderColor = '#00ff00';
    
    setTimeout(() => {
      shape.style.transform = 'scale(1)';
      shape.style.borderColor = 'transparent';
    }, 300);
  }
}

// Helper: Update partner's memory challenge
function updatePartnerMemoryChallenge(section, data) {
  const statusMessage = document.getElementById(`statusMessage${section}`);
  if (!statusMessage) return;
  
  statusMessage.textContent = `PARTNER: ${data.phase}`;
  statusMessage.style.color = data.correct ? '#00ff00' : '#ffaa00';
}


function updateTimer() {
  const elapsed = (Date.now() - startTime) / 1000;
  document.getElementById('gameTimer').textContent = `TIME: ${elapsed.toFixed(2)}s`;
}

function stopFirstGameTimer() {
  console.log('Stopping first game timer and countdown');
  clearInterval(timerInterval);
  clearInterval(countdownInterval);
  timerInterval = null;
  countdownInterval = null;
  
  // Also reset the countdown display to prevent visual confusion
  updateCountdownDots();
  countdown = 999; // Set to high number so it never times out
}

function stopAllTimers() {
  console.log('Stopping all timers');
  clearInterval(timerInterval);
  clearInterval(countdownInterval);
  clearInterval(numberSequenceInterval);
  timerInterval = null;
  countdownInterval = null;
  numberSequenceInterval = null;
}

function startCountdown() {
  // Personal timers are already initialized from server
  gameCountdownActive = true;  // Mark that game countdown has started
  
  // Dispatch event to trigger memory game phases
  window.dispatchEvent(new Event('gameCountdownStarted'));
  updateCountdownDots();
  clearInterval(countdownInterval); // Clear any existing interval
  
  countdownInterval = setInterval(() => {
    // Safety check: if number sequence is active, don't count down
    if (numberSequenceInterval) {
      console.log('Number sequence active, skipping countdown');
      return;
    }
    
    // Decrement all personal timers
    let anyExpired = false;
    Object.keys(personalTimers).forEach(playerColor => {
      if (personalTimers[playerColor] > 0) {
        personalTimers[playerColor]--;
        console.log(`${playerColor} timer: ${personalTimers[playerColor]}s`);
      }
      if (personalTimers[playerColor] <= 0) {
        anyExpired = true;
      }
    });
    
    updateCountdownDots();
    
    if (anyExpired) {
      console.log('A player timer expired!');
      stopAllTimers();
      // Server will handle game end when it detects expired timer
    }
  }, 1000);
}

function updateCountdownDots() {
  [1, 2, 3, 4].forEach(section => {
    const container = document.getElementById(`countdownDots${section}`);
    if (container) {
      // Determine which color is in this section
      const sectionElement = document.getElementById(`section${section}`);
      let sectionColor = null;
      let sectionTimer = 0;
      
      if (sectionElement.classList.contains('player-red')) {
        sectionColor = 'red';
        sectionTimer = personalTimers.red;
      } else if (sectionElement.classList.contains('player-blue')) {
        sectionColor = 'blue';
        sectionTimer = personalTimers.blue;
      } else if (sectionElement.classList.contains('player-green')) {
        sectionColor = 'green';
        sectionTimer = personalTimers.green;
      } else if (sectionElement.classList.contains('player-yellow')) {
        sectionColor = 'yellow';
        sectionTimer = personalTimers.yellow;
      }
      
      container.innerHTML = '';
      for (let i = 0; i < GAME_CONSTANTS.INITIAL_COUNTDOWN; i++) {
        const dot = document.createElement('span');
        dot.className = `dot ${i < sectionTimer ? 'active' : ''}`;
        
        // Apply player color to active dots based on section
        if (i < sectionTimer) {
          if (sectionColor === 'red') {
            dot.style.background = '#ff4444';
            dot.style.boxShadow = '0 0 10px #ff4444';
          } else if (sectionColor === 'blue') {
            dot.style.background = '#4444ff';
            dot.style.boxShadow = '0 0 10px #4444ff';
          } else if (sectionColor === 'green') {
            dot.style.background = '#44aa44';
            dot.style.boxShadow = '0 0 10px #44aa44';
          } else if (sectionColor === 'yellow') {
            dot.style.background = '#ffaa00';
            dot.style.boxShadow = '0 0 10px #ffaa00';
          }
        } else {
          // Inactive dots remain dark green
          dot.style.background = '#008800';
          dot.style.boxShadow = 'none';
        }
        
        container.appendChild(dot);
      }
    }
  });
}

function setupFindSix(section, grid, isInteractive = true) {
  console.log(`Setting up Find the 6s game in section ${section}, interactive: ${isInteractive}`);
  
  const gridContainer = document.getElementById(`grid${section}`);
  gridContainer.innerHTML = '';
  gridContainer.style.gridTemplateColumns = 'repeat(8, 55px)';
  gridContainer.style.gridTemplateRows = 'repeat(3, 55px)';

  let foundSixes = 0;
  let totalSixes = 0;

  // First count total sixes
  grid.forEach((num) => {
    if (num === '6') {
      totalSixes++;
    }
  });

  console.log(`Total sixes to find: ${totalSixes}`);

  grid.forEach((num, index) => {
    const cell = document.createElement('div');
    cell.textContent = num;
    cell.style.cursor = isInteractive ? 'none' : 'default';
    
    if (num === '6') {
      cell.dataset.isSix = 'true';
    }
    
    if (isInteractive) {
      cell.onmouseenter = () => {
        if (ownCursor) ownCursor.style.transform = 'scale(1.2)';
      };
      
      cell.onmouseleave = () => {
        if (ownCursor) ownCursor.style.transform = 'scale(1)';
      };
      
      cell.onclick = () => {
        const value = parseInt(cell.textContent);
        console.log(`Clicked cell: ${value}, isSix: ${cell.dataset.isSix}, alreadyFound: ${cell.dataset.found}`);
        
        const success = (value === 6 && !cell.dataset.found);
        
        // EMIT action to partner
        socket.emit('gameAction', {
          room: room,
          action: {
            color: color,
            gameType: 'findSix',
            actionType: 'cellClick'
          },
          data: {
            index: index,
            success: success
          }
        });
        
        if (value === 6 && !cell.dataset.found) {
          cell.dataset.found = 'true';
          cell.style.color = '#00ff00';
          cell.style.textShadow = '0 0 15px #00ff00';
          foundSixes++;
          
          console.log(`Found six! ${foundSixes}/${totalSixes}`);
          
          if (foundSixes === totalSixes) {
            console.log('All sixes found! Completing round...');
            completeRound();
          }
        } else if (value !== 6) {
          cell.style.color = '#ff4444';
          cell.style.textShadow = '0 0 15px #ff4444';
          setTimeout(() => {
            cell.style.color = '#ffffff';
            cell.style.textShadow = '0 0 15px #ffffff, 0 0 25px #ffffff';
          }, 500);
        }
      };
    } else {
      // For partner's view, make it non-interactive
      cell.style.pointerEvents = 'none';
      cell.style.opacity = '0.7';
    }
    
    gridContainer.appendChild(cell);
  });

  const statusMessage = document.getElementById(`statusMessage${section}`);
  statusMessage.textContent = isInteractive ? 'FIND ALL THE 6S!' : 'PARTNER\'S GAME';
  statusMessage.style.color = '#00ff00';
}

function setupFindNine(section, grid, isInteractive = true) {
  console.log(`Setting up Find the 9s game in section ${section}, interactive: ${isInteractive}`);
  
  const gridContainer = document.getElementById(`grid${section}`);
  gridContainer.innerHTML = '';
  gridContainer.style.gridTemplateColumns = 'repeat(8, 55px)';
  gridContainer.style.gridTemplateRows = 'repeat(3, 55px)';

  let foundNines = 0;
  let totalNines = 0;

  // First count total nines
  grid.forEach((num) => {
    if (num === '9') {
      totalNines++;
    }
  });

  console.log(`Total nines to find: ${totalNines}`);

  grid.forEach((num, index) => {
    const cell = document.createElement('div');
    cell.textContent = num;
    cell.style.cursor = isInteractive ? 'none' : 'default';
    
    if (num === '9') {
      cell.dataset.isNine = 'true';
    }
    
    if (isInteractive) {
      cell.onmouseenter = () => {
        if (ownCursor) ownCursor.style.transform = 'scale(1.2)';
      };
      
      cell.onmouseleave = () => {
        if (ownCursor) ownCursor.style.transform = 'scale(1)';
      };
      
      cell.onclick = () => {
        const value = parseInt(cell.textContent);
        console.log(`Clicked cell: ${value}, isNine: ${cell.dataset.isNine}, alreadyFound: ${cell.dataset.found}`);
        
        const success = (value === 9 && !cell.dataset.found);
        
        // EMIT action to partner
        socket.emit('gameAction', {
          room: room,
          action: {
            color: color,
            gameType: 'findNine',
            actionType: 'cellClick'
          },
          data: {
            index: index,
            success: success
          }
        });
        
        if (value === 9 && !cell.dataset.found) {
          cell.dataset.found = 'true';
          cell.style.color = '#00ff00';
          cell.style.textShadow = '0 0 15px #00ff00';
          foundNines++;
          
          console.log(`Found nine! ${foundNines}/${totalNines}`);
          
          if (foundNines === totalNines) {
            console.log('All nines found! Completing round...');
            completeRound();
          }
        } else if (value !== 9) {
          cell.style.color = '#ff4444';
          cell.style.textShadow = '0 0 15px #ff4444';
          setTimeout(() => {
            cell.style.color = '#ffffff';
            cell.style.textShadow = '0 0 15px #ffffff, 0 0 25px #ffffff';
          }, 500);
        }
      };
    } else {
      // For partner's view, make it non-interactive
      cell.style.pointerEvents = 'none';
      cell.style.opacity = '0.7';
    }
    
    gridContainer.appendChild(cell);
  });

  const statusMessage = document.getElementById(`statusMessage${section}`);
  statusMessage.textContent = isInteractive ? 'FIND ALL THE 9S!' : 'PARTNER\'S GAME';
  statusMessage.style.color = '#00ff00';
}

function setupColorMatch(section, isInteractive = true) {
  console.log(`Setting up Color Match game in section ${section}, interactive: ${isInteractive}`);
  
  const colorMatchGame = document.getElementById(`colorMatchGame${section}`);
  colorMatchGame.innerHTML = '';

  const colors = ['red', 'blue', 'green', 'yellow'];
  const colorNames = ['RED', 'BLUE', 'GREEN', 'YELLOW'];
  
  // Reset match counter (only for interactive)
  if (isInteractive) {
    cyclesSinceLastMatch = 0;
  }
  
  const colorCircle = document.createElement('div');
  colorCircle.className = 'colorCircle';
  
  const colorNameDisplay = document.createElement('div');
  colorNameDisplay.className = 'colorNameDisplay';
  
  const instruction = document.createElement('div');
  instruction.textContent = 'CLICK WHEN COLOR MATCHES TEXT:';
  
  const targetElement = document.createElement('div');
  targetElement.className = 'color-target';
  targetElement.appendChild(instruction);
  targetElement.appendChild(colorCircle);
  targetElement.appendChild(colorNameDisplay);
  
  colorMatchGame.appendChild(targetElement);
  
  let currentColorIndex = 0;
  let currentNameIndex = 0;
  let colorInterval;
  let nameInterval;
  let gameCompleted = false;

  function getRandomIndex(excludeIndex = -1) {
    let newIndex;
    do {
      newIndex = Math.floor(Math.random() * colors.length);
    } while (newIndex === excludeIndex && colors.length > 1);
    return newIndex;
  }
  
  // Reset completed flag and check if partner already completed
  const sectionKey = `section${section}`;
  gameCompleted = colorMatchIntervals[sectionKey].completed;
  
  // If partner already completed, show completed state and return
  if (gameCompleted) {
    colorCircle.style.border = '3px solid #00ff00';
    colorCircle.style.boxShadow = '0 0 25px #00ff00';
    const statusMessage = document.getElementById(`statusMessage${section}`);
    if (statusMessage) {
      statusMessage.textContent = 'COMPLETED!';
      statusMessage.style.color = '#00ff00';
    }
    return;
  }

  function updateColor() {
    if (gameCompleted) return;
    
    cyclesSinceLastMatch++;
    
    // Force a match every 4 cycles if no match occurred
    if (cyclesSinceLastMatch >= 4) {
      currentColorIndex = currentNameIndex; // Make them match
      cyclesSinceLastMatch = 0;
    } else {
      // Regular random color, but ensure it's different from current
      currentColorIndex = getRandomIndex(currentColorIndex);
    }
    
    colorCircle.style.backgroundColor = colors[currentColorIndex];
  }

  function updateName() {
    if (gameCompleted) return;
    
    // If we're forcing a match, keep the name matching the color
    if (cyclesSinceLastMatch === 0) {
      currentNameIndex = currentColorIndex;
    } else {
      // Regular random name
      currentNameIndex = getRandomIndex(currentNameIndex);
    }
    
    colorNameDisplay.textContent = colorNames[currentNameIndex];
    
    // For text color, always use a random different color for visual challenge
    let textColorIndex;
    do {
      textColorIndex = getRandomIndex();
    } while (textColorIndex === currentNameIndex && colors.length > 1);
    
    colorNameDisplay.style.color = colors[textColorIndex];
  }

  currentColorIndex = getRandomIndex();
  currentNameIndex = getRandomIndex(currentColorIndex);
  
  colorInterval = setInterval(updateColor, 1000);
  nameInterval = setInterval(updateName, 1000);
  
  // Store intervals globally so they can be stopped by partner completion
  colorMatchIntervals[sectionKey].colorInterval = colorInterval;
  colorMatchIntervals[sectionKey].nameInterval = nameInterval;

  colorCircle.style.backgroundColor = colors[currentColorIndex];
  colorNameDisplay.textContent = colorNames[currentNameIndex];
  colorNameDisplay.style.color = colors[getRandomIndex()];

  colorCircle.onmouseenter = () => {
    if (ownCursor && !gameCompleted && isInteractive) ownCursor.style.transform = 'scale(1.3)';
  };
  
  colorCircle.onmouseleave = () => {
    if (ownCursor && !gameCompleted && isInteractive) ownCursor.style.transform = 'scale(1)';
  };

  if (isInteractive) {
    colorCircle.onclick = () => {
      if (gameCompleted) return;
      
      const circleColor = colors[currentColorIndex];
      const displayedName = colorNames[currentNameIndex].toLowerCase();
      
      console.log('=== COLOR MATCH DEBUG ===');
      console.log('Circle background color:', circleColor);
      console.log('Displayed text content:', displayedName);
      console.log('Match result:', circleColor === displayedName);
      console.log('Current color index:', currentColorIndex);
      console.log('Current name index:', currentNameIndex);
      console.log('Cycles since last match:', cyclesSinceLastMatch);
      console.log('=========================');
      
      const wasCorrect = (circleColor === displayedName);
      
      // EMIT action to partner
      socket.emit('gameAction', {
        room: room,
        action: {
          color: color,
          gameType: 'colorMatch',
          actionType: 'colorClick'
        },
        data: {
          wasCorrect: wasCorrect
        }
      });
      
      if (wasCorrect) {
        console.log('Color match correct! Completing round...');
        
        // Set global completed flag to stop partner's cycling
        colorMatchIntervals[sectionKey].completed = true;
        gameCompleted = true;
        colorCircle.style.border = '3px solid #00ff00';
        colorCircle.style.boxShadow = '0 0 25px #00ff00';
        
        clearInterval(colorInterval);
        clearInterval(nameInterval);
        
        const statusMessage = document.getElementById(`statusMessage${section}`);
        statusMessage.textContent = 'COMPLETED!';
        statusMessage.style.color = '#00ff00';
        
        setTimeout(() => {
          completeRound();
        }, 300);
      } else {
        colorCircle.style.border = '3px solid #ff4444';
        colorCircle.style.boxShadow = '0 0 25px #ff4444';
        
        setTimeout(() => {
          if (!gameCompleted) {
            colorCircle.style.border = '3px solid #00ff00';
            colorCircle.style.boxShadow = '0 0 15px rgba(0, 255, 0, 0.3)';
          }
        }, 500);
      }
    };
  } else {
    // Non-interactive: disable pointer events
    colorCircle.style.pointerEvents = 'none';
    colorCircle.style.opacity = '0.8';
  }

  const statusMessage = document.getElementById(`statusMessage${section}`);
  statusMessage.textContent = isInteractive ? 'MATCH COLOR TO TEXT!' : 'PARTNER\'S GAME';
  statusMessage.style.color = '#00ff00';
}

function setupShapeMemory(section, isInteractive = true) {
  console.log(`Setting up Shape Memory game in section ${section}, interactive: ${isInteractive}`);
  
  const colorMatchGame = document.getElementById(`colorMatchGame${section}`);
  colorMatchGame.innerHTML = '';
  
  const shapes = ['●', '■', '▲', '◆'];
  const colors = ['red', 'blue', 'green', 'yellow'];
  
  const shuffledShapes = [...shapes].sort(() => Math.random() - 0.5);
  const shuffledColors = [...colors].sort(() => Math.random() - 0.5);
  
  const memoryShapes = shuffledShapes.slice(0, 4).map((shape, i) => ({
    shape: shape,
    color: shuffledColors[i]
  }));
  
  const targetIndex = Math.floor(Math.random() * 4);
  const targetShape = memoryShapes[targetIndex];
  
  const memContainer = document.createElement('div');
  memContainer.className = 'shape-memory-container';
  memContainer.style.display = 'grid';
  memContainer.style.gridTemplateColumns = 'repeat(2, 1fr)';
  memContainer.style.gap = '20px';
  memContainer.style.margin = '20px 0';
  
  memoryShapes.forEach(item => {
    const shapeDiv = document.createElement('div');
    shapeDiv.textContent = item.shape;
    shapeDiv.style.fontSize = '4rem';
    shapeDiv.style.color = getColorHex(item.color);
    shapeDiv.style.textAlign = 'center';
    memContainer.appendChild(shapeDiv);
  });
  
  colorMatchGame.appendChild(memContainer);
  
  const statusMessage = document.getElementById(`statusMessage${section}`);
  statusMessage.textContent = 'MEMORIZE SHAPES AND COLORS';
  statusMessage.style.color = '#00ff00';
  
  waitForCountdownThen(() => {
    memContainer.innerHTML = '';
    
    const instruction = document.createElement('div');
    instruction.textContent = 'SELECT THE MATCHING SHAPE:';
    instruction.style.fontSize = '1.2rem';
    instruction.style.marginBottom = '20px';
    memContainer.appendChild(instruction);
    
    const options = [targetShape];
    const wrongShapes = shapes.filter(s => s !== targetShape.shape).sort(() => Math.random() - 0.5).slice(0, 2);
    wrongShapes.forEach(shape => {
      const wrongColor = colors.filter(c => c !== targetShape.color)[Math.floor(Math.random() * 3)];
      options.push({ shape, color: wrongColor });
    });
    
    options.sort(() => Math.random() - 0.5);
    
    const optionsContainer = document.createElement('div');
    optionsContainer.style.display = 'flex';
    optionsContainer.style.gap = '30px';
    optionsContainer.style.justifyContent = 'center';
    
    options.forEach((option) => {
      const optionDiv = document.createElement('div');
      optionDiv.textContent = option.shape;
      optionDiv.style.fontSize = '4rem';
      optionDiv.style.color = getColorHex(option.color);
      optionDiv.style.cursor = 'none';
      optionDiv.style.padding = '20px';
      optionDiv.style.border = '2px solid transparent';
      optionDiv.style.borderRadius = '10px';
      
      optionDiv.onmouseenter = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1.3)';
      };
      
      optionDiv.onmouseleave = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1)';
      };
      
      if (isInteractive) {
        optionDiv.onclick = () => {
          const isCorrect = (option.shape === targetShape.shape && option.color === targetShape.color);
          
          // EMIT action to partner
          socket.emit('gameAction', {
            room: room,
            action: {
              color: color,
              gameType: 'shapeMemory',
              actionType: 'shapeClick'
            },
            data: {
              correct: isCorrect
            }
          });
          
          if (isCorrect) {
            console.log('Shape memory correct! Completing round...');
            optionDiv.style.border = '2px solid #00ff00';
            statusMessage.textContent = 'CORRECT!';
            statusMessage.style.color = '#00ff00';
            
            setTimeout(() => {
              completeRound();
            }, 1000);
          } else {
            optionDiv.style.border = '2px solid #ff4444';
            statusMessage.textContent = 'WRONG! TRY AGAIN';
            statusMessage.style.color = '#ff4444';
            
            setTimeout(() => {
              optionDiv.style.border = '2px solid transparent';
              statusMessage.textContent = 'SELECT THE MATCHING SHAPE';
              statusMessage.style.color = '#00ff00';
            }, 1000);
          }
        };
      } else {
        // Non-interactive: disable pointer events
        optionDiv.style.pointerEvents = 'none';
        optionDiv.style.opacity = '0.7';
      }
      
      optionsContainer.appendChild(optionDiv);
    });
    
    memContainer.appendChild(optionsContainer);
    statusMessage.textContent = isInteractive ? 'SELECT THE MATCHING SHAPE' : 'PARTNER\'S GAME';
  }, 4000);
}

// Memory Challenge Game
function setupMemoryChallenge(section, isInteractive = true) {
  console.log(`Setting up Memory Challenge game in section ${section}, interactive: ${isInteractive}`);
  
  const colorMatchGame = document.getElementById(`colorMatchGame${section}`);
  colorMatchGame.innerHTML = '';

  // Game state for this section
  const gameState = {
    active: isInteractive, // Only active if interactive
    phase: 'memory',
    memoryData: null,
    currentChallenge: null,
    consecutiveType1: 0,
    consecutiveType2: 0,
    maxConsecutive: 3
  };

  const colors = ['#ff4444', '#4444ff', '#44aa44', '#ffaa00'];

  function setupMemoryPhase() {
    const memoryContainer = document.createElement('div');
    memoryContainer.className = 'memory-challenge-container';
    
    const heading = document.createElement('h3');
    heading.textContent = 'REMEMBER THE COLORS AND NUMBERS';
    heading.style.fontSize = '1.6rem';
    heading.style.marginBottom = '30px';
    heading.style.color = '#00ff00';
    heading.style.textShadow = '0 0 10px #00ff00';
    
    const memoryDisplay = document.createElement('div');
    memoryDisplay.className = 'memory-display';
    memoryDisplay.style.display = 'flex';
    memoryDisplay.style.justifyContent = 'center';
    memoryDisplay.style.gap = '30px';
    memoryDisplay.style.margin = '20px 0';
    memoryDisplay.style.flexWrap = 'wrap';

    // Generate memory data
    gameState.memoryData = [];
    const usedNumbers = new Set();
    const usedColors = [...colors];
    
    for (let i = 0; i < 3; i++) {
      let number;
      do {
        number = Math.floor(Math.random() * 9) + 1;
      } while (usedNumbers.has(number));
      usedNumbers.add(number);
      
      const colorIndex = Math.floor(Math.random() * usedColors.length);
      const color = usedColors[colorIndex];
      usedColors.splice(colorIndex, 1);
      
      gameState.memoryData.push({ number, color });
      
      const circle = document.createElement('div');
      circle.style.width = '80px';
      circle.style.height = '80px';
      circle.style.borderRadius = '50%';
      circle.style.display = 'flex';
      circle.style.alignItems = 'center';
      circle.style.justifyContent = 'center';
      circle.style.fontSize = '2rem';
      circle.style.fontWeight = '700';
      circle.style.color = '#ffffff';
      circle.style.textShadow = '0 0 5px #000';
      circle.style.border = '3px solid #000';
      circle.style.boxShadow = '0 0 0 3px #000, 0 0 0 6px currentColor';
      circle.style.color = color;
      circle.textContent = number;
      memoryDisplay.appendChild(circle);
    }

    memoryContainer.appendChild(heading);
    memoryContainer.appendChild(memoryDisplay);
    colorMatchGame.appendChild(memoryContainer);

    // Transition to challenge phase after 4 seconds
    waitForCountdownThen(() => {
      if (gameState.active) {
        memoryContainer.remove();
        setupChallengePhase();
      }
    }, 4000);
  }

  function setupChallengePhase() {
    const challengeContainer = document.createElement('div');
    challengeContainer.className = 'challenge-container';
    
    // Determine challenge type with balanced randomness
    let challengeType;
    if (gameState.consecutiveType1 >= gameState.maxConsecutive) {
      challengeType = 2;
    } else if (gameState.consecutiveType2 >= gameState.maxConsecutive) {
      challengeType = 1;
    } else {
      challengeType = Math.random() < 0.5 ? 1 : 2;
    }
    
    if (challengeType === 1) {
      gameState.consecutiveType1++;
      gameState.consecutiveType2 = 0;
    } else {
      gameState.consecutiveType2++;
      gameState.consecutiveType1 = 0;
    }
    
    gameState.currentChallenge = {
      type: challengeType,
      correctAnswer: null
    };

    if (challengeType === 1) {
      setupColorRecallChallenge(challengeContainer);
    } else {
      setupMathRecallChallenge(challengeContainer);
    }
    
    colorMatchGame.appendChild(challengeContainer);
  }

  function setupColorRecallChallenge(container) {
    const randomIndex = Math.floor(Math.random() * gameState.memoryData.length);
    const targetData = gameState.memoryData[randomIndex];
    
    const numberDisplay = document.createElement('div');
    numberDisplay.style.fontSize = '3.5rem';
    numberDisplay.style.fontWeight = '700';
    numberDisplay.style.color = '#ffffff';
    numberDisplay.style.textShadow = '0 0 15px #ffffff';
    numberDisplay.style.marginBottom = '30px';
    numberDisplay.style.letterSpacing = '3px';
    numberDisplay.textContent = targetData.number;
    container.appendChild(numberDisplay);
    
    const optionsContainer = document.createElement('div');
    optionsContainer.style.display = 'flex';
    optionsContainer.style.justifyContent = 'center';
    optionsContainer.style.gap = '25px';
    optionsContainer.style.marginTop = '20px';
    optionsContainer.style.flexWrap = 'wrap';
    
    const correctColor = targetData.color;
    const wrongColors = colors.filter(color => color !== correctColor)
                            .sort(() => Math.random() - 0.5)
                            .slice(0, 2);
    
    const allOptions = [correctColor, ...wrongColors].sort(() => Math.random() - 0.5);
    
    allOptions.forEach((color, index) => {
      const option = document.createElement('div');
      option.style.width = '70px';
      option.style.height = '70px';
      option.style.borderRadius = '50%';
      option.style.cursor = 'none';
      option.style.border = '3px solid #000';
      option.style.boxShadow = '0 0 0 3px #000, 0 0 0 6px currentColor';
      option.style.backgroundColor = color;
      option.style.transition = 'all 0.3s ease';
      option.dataset.color = color;
      option.dataset.correct = (color === correctColor).toString();
      
      option.onmouseenter = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1.3)';
      };
      
      option.onmouseleave = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1)';
      };
      
      if (isInteractive) {
        option.onclick = () => {
          if (!gameState.active) return;
          
          const isCorrect = option.dataset.correct === 'true';
          
          // EMIT action to partner
          socket.emit('gameAction', {
            room: room,
            action: {
              color: color,
              gameType: 'memoryChallenge',
              actionType: 'memoryClick'
            },
            data: {
              phase: 'COLOR_RECALL',
              correct: isCorrect
            }
          });
          
          if (isCorrect) {
            option.style.boxShadow = '0 0 0 3px #000, 0 0 0 8px #00ff00, 0 0 20px #00ff00';
            
            const statusMessage = document.getElementById(`statusMessage${section}`);
            statusMessage.textContent = 'COMPLETED!';
            statusMessage.style.color = '#00ff00';
            
            gameState.active = false;
            setTimeout(() => {
              completeRound();
            }, 500);
          } else {
            option.style.boxShadow = '0 0 0 3px #000, 0 0 0 8px #ff4444, 0 0 20px #ff4444';
            
            const statusMessage = document.getElementById(`statusMessage${section}`);
            statusMessage.textContent = 'WRONG! TRY AGAIN';
            statusMessage.style.color = '#ff4444';
            
            setTimeout(() => {
              option.style.boxShadow = '0 0 0 3px #000, 0 0 0 6px currentColor';
              statusMessage.textContent = 'SELECT THE CORRECT COLOR';
              statusMessage.style.color = '#00ff00';
            }, 1000);
          }
        };
      } else {
        // Non-interactive: disable pointer events
        option.style.pointerEvents = 'none';
        option.style.opacity = '0.7';
      }
      
      optionsContainer.appendChild(option);
    });
    
    container.appendChild(optionsContainer);
    gameState.currentChallenge.correctAnswer = correctColor;
    
    const statusMessage = document.getElementById(`statusMessage${section}`);
    statusMessage.textContent = 'SELECT THE CORRECT COLOR';
    statusMessage.style.color = '#00ff00';
  }

  function setupMathRecallChallenge(container) {
    const correctTotal = gameState.memoryData.reduce((sum, data) => sum + data.number, 0);
    
    const wrongAnswers = [];
    while (wrongAnswers.length < 2) {
      const wrong = correctTotal + (Math.random() < 0.5 ? -1 : 1) * (Math.floor(Math.random() * 3) + 1);
      if (wrong !== correctTotal && wrong > 0 && wrong < 28 && !wrongAnswers.includes(wrong)) {
        wrongAnswers.push(wrong);
      }
    }
    
    const allOptions = [correctTotal, ...wrongAnswers].sort(() => Math.random() - 0.5);
    
    const optionsContainer = document.createElement('div');
    optionsContainer.style.display = 'flex';
    optionsContainer.style.justifyContent = 'center';
    optionsContainer.style.gap = '25px';
    optionsContainer.style.marginTop = '20px';
    optionsContainer.style.flexWrap = 'wrap';
    
    allOptions.forEach((number, index) => {
      const option = document.createElement('div');
      option.style.width = '70px';
      option.style.height = '70px';
      option.style.borderRadius = '50%';
      option.style.display = 'flex';
      option.style.alignItems = 'center';
      option.style.justifyContent = 'center';
      option.style.fontSize = '1.8rem';
      option.style.fontWeight = '700';
      option.style.cursor = 'none';
      option.style.border = '3px solid #000';
      option.style.boxShadow = '0 0 0 3px #000, 0 0 0 6px #ffffff';
      option.style.color = '#000000';
      option.style.backgroundColor = '#ffffff';
      option.style.textShadow = '0 0 5px #fff';
      option.style.transition = 'all 0.3s ease';
      option.textContent = number;
      option.dataset.number = number;
      option.dataset.correct = (number === correctTotal).toString();
      
      option.onmouseenter = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1.3)';
      };
      
      option.onmouseleave = () => {
        if (ownCursor && isInteractive) ownCursor.style.transform = 'scale(1)';
      };
      
      if (isInteractive) {
        option.onclick = () => {
          if (!gameState.active) return;
          
          const isCorrect = option.dataset.correct === 'true';
          
          // EMIT action to partner
          socket.emit('gameAction', {
            room: room,
            action: {
              color: color,
              gameType: 'memoryChallenge',
              actionType: 'memoryClick'
            },
            data: {
              phase: 'MATH_RECALL',
              correct: isCorrect
            }
          });
          
          if (isCorrect) {
            option.style.boxShadow = '0 0 0 3px #000, 0 0 0 8px #00ff00, 0 0 20px #00ff00';
            
            const statusMessage = document.getElementById(`statusMessage${section}`);
            statusMessage.textContent = 'COMPLETED!';
            statusMessage.style.color = '#00ff00';
            
            gameState.active = false;
            setTimeout(() => {
              completeRound();
            }, 500);
          } else {
            option.style.boxShadow = '0 0 0 3px #000, 0 0 0 8px #ff4444, 0 0 20px #ff4444';
            
            const statusMessage = document.getElementById(`statusMessage${section}`);
            statusMessage.textContent = 'WRONG! TRY AGAIN';
            statusMessage.style.color = '#ff4444';
            
            setTimeout(() => {
              option.style.boxShadow = '0 0 0 3px #000, 0 0 0 6px #ffffff';
              statusMessage.textContent = 'SELECT THE CORRECT TOTAL';
              statusMessage.style.color = '#00ff00';
            }, 1000);
          }
        };
      } else {
        // Non-interactive: disable pointer events
        option.style.pointerEvents = 'none';
        option.style.opacity = '0.7';
      }
      
      optionsContainer.appendChild(option);
    });
    
    container.appendChild(optionsContainer);
    gameState.currentChallenge.correctAnswer = correctTotal;
    
    const statusMessage = document.getElementById(`statusMessage${section}`);
    statusMessage.textContent = 'SELECT THE CORRECT TOTAL';
    statusMessage.style.color = '#00ff00';
  }

  // Start the memory challenge
  setupMemoryPhase();

  const statusMessage = document.getElementById(`statusMessage${section}`);
  statusMessage.textContent = isInteractive ? 'MEMORIZE THE COLORS AND NUMBERS' : 'PARTNER\'S GAME';
  statusMessage.style.color = '#00ff00';
}

function completeRound(success = true) {
  console.log(`Completing round for ${color}, section ${sectionIndex}, success: ${success}`);
  console.log('Current game type:', myGameType);
  
  // DON'T STOP THE COUNTDOWN - timers continue running in Phase 1
  // clearInterval(countdownInterval);
  // countdownInterval = null;
  console.log('Round completed - timers continue running');
  
  socket.emit('roundComplete', { room, color, success });
  
  const statusMessage = document.getElementById(`statusMessage${sectionIndex}`);
  if (success) {
    statusMessage.textContent = 'COMPLETED! +4s TO PARTNER!';
    statusMessage.style.color = '#00ff00';
  } else {
    statusMessage.textContent = 'FAILED! -3s FROM PARTNER!';
    statusMessage.style.color = '#ff4444';
  }
}

// Number Sequence Game Functions
function showNumberSequenceScreen() {
  console.log('Showing number sequence screen');
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById('numberSequenceScreen').classList.add('active');
  
  document.body.style.overflow = 'hidden';
  document.getElementById('numberSequenceGame').style.height = 'calc(100vh - 200px)';
}

function setupNumberSequenceGame(sequenceData, positions) {
  console.log('Setting up number sequence game with data:', sequenceData, positions);
  
  const gameContainer = document.getElementById('numberSequenceGame');
  gameContainer.innerHTML = '';
  
  gameContainer.style.width = '100vw';
  gameContainer.style.height = 'calc(100vh - 200px)';
  gameContainer.style.margin = '0';
  gameContainer.style.border = 'none';
  gameContainer.style.position = 'relative';
  gameContainer.style.background = 'transparent';
  
  for (let number = 1; number <= 12; number++) {
    const circle = document.createElement('div');
    circle.className = `number-circle ${sequenceData[number]}`;
    circle.textContent = number;
    circle.dataset.number = number;
    
    // Use the pre-generated positions from server
    const position = positions[number];
    const x = position.x; // percentage
    const y = position.y; // percentage
    
    circle.style.left = `${x}%`;
    circle.style.top = `${y}%`;
    circle.style.position = 'absolute';
    circle.style.transform = 'translate(-50%, -50%)'; // Center the circle on the position
    
    circle.addEventListener('click', handleNumberSequenceClick);
    
    circle.addEventListener('mouseenter', () => {
      if (ownCursor) ownCursor.style.transform = 'scale(1.4)';
    });
    
    circle.addEventListener('mouseleave', () => {
      if (ownCursor) ownCursor.style.transform = 'scale(1)';
    });
    
    gameContainer.appendChild(circle);
  }
  
  document.getElementById('numberSequenceStatus').textContent = 'CLICK NUMBER 1 TO START';
  document.getElementById('numberSequenceStatus').style.color = '';
}

function handleNumberSequenceClick(event) {
  const clickedNumber = parseInt(event.target.dataset.number);
  const circleColor = event.target.className.split(' ')[1];
  
  console.log(`Number sequence click: number=${clickedNumber}, color=${circleColor}, myColor=${color}`);
  
  if (circleColor === color) {
    socket.emit('numberSequenceClick', {
      room: room,
      number: clickedNumber,
      color: color
    });
  } else {
    event.target.classList.add('wrong');
    setTimeout(() => {
      event.target.classList.remove('wrong');
    }, 500);
    
    const statusElement = document.getElementById('numberSequenceStatus');
    statusElement.textContent = `NOT YOUR COLOR! CLICK ${color.toUpperCase()} CIRCLES`;
    statusElement.style.color = '#ff4444';
    setTimeout(() => {
      statusElement.style.color = '';
      statusElement.textContent = `NEXT: NUMBER ${currentSequenceNumber}`;
    }, 2000);
  }
}

function startNumberSequenceTimer() {
  console.log('Starting 24-second timer for number sequence game');
  numberSequenceTimer = GAME_CONSTANTS.NUMBER_SEQUENCE_TIME;
  updateNumberSequenceTimer();
  
  clearInterval(numberSequenceInterval);
  numberSequenceInterval = setInterval(() => {
    numberSequenceTimer--;
    console.log(`Number sequence timer: ${numberSequenceTimer}s`);
    updateNumberSequenceTimer();
    
    if (numberSequenceTimer <= 0) {
      console.log('Number sequence game timeout!');
      clearInterval(numberSequenceInterval);
      const statusElement = document.getElementById('numberSequenceStatus');
      statusElement.textContent = 'TIME EXPIRED! MISSION FAILED';
      statusElement.style.color = '#ff4444';
      
      setTimeout(() => {
        socket.emit('timeout', { room });
      }, 2000);
    }
  }, 1000);
}

function updateNumberSequenceTimer() {
  const timerContainer = document.getElementById('numberSequenceTimer');
  timerContainer.innerHTML = '';
  
  for (let i = 0; i < GAME_CONSTANTS.NUMBER_SEQUENCE_TIME; i++) {
    const dot = document.createElement('div');
    dot.className = `timer-dot ${i < numberSequenceTimer ? '' : 'expired'}`;
    
    // Add white color style for number sequence timer
    if (i < numberSequenceTimer) {
      dot.style.background = '#ffffff';
      dot.style.boxShadow = '0 0 5px #ffffff';
    } else {
      dot.style.background = '#666666';
      dot.style.boxShadow = 'none';
    }
    
    timerContainer.appendChild(dot);
  }
}

socket.on('gameOver', (data) => {
  console.log('Game over received:', data);
  stopAllTimers();
  
  // Show Blue Angels themed results screen
  showResultsScreen(data);
});

function showResultsScreen(data) {
  // Hide all other screens
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  // Check if mission failed - show failure screen with video
  if (data.timeout || !data.completed) {
    showFailureScreen(data);
    return;
  }
  
  // Show results screen (success)
  const resultsScreen = document.getElementById('resultsScreen');
  resultsScreen.classList.add('active');
  
  // Set mission status
  const missionStatus = document.getElementById('missionStatus');
  missionStatus.textContent = 'MISSION COMPLETE';
  missionStatus.classList.remove('failed');
  
  // Set team name
  document.getElementById('teamNameDisplay').textContent = data.teamName;
  
  // Set team pilots (call signs)
  const teamPilotsDisplay = document.getElementById('teamPilotsDisplay');
  if (teamPilotsDisplay && data.players && data.players.length > 0) {
    teamPilotsDisplay.textContent = `PILOTS: ${data.players.join(' & ')}`;
  }
  
  // Set stats
  document.getElementById('finalTime').textContent = `${parseFloat(data.time).toFixed(2)}s`;
  document.getElementById('finalRank').textContent = `#${data.rank}`;
  document.getElementById('totalTeams').textContent = data.totalTeams;
  document.getElementById('bestTime').textContent = `${data.bestTime.toFixed(2)}s`;
  
  // Calculate games played (3 rounds * 4 players)
  const gamesPlayed = data.completed ? 12 : Math.floor((parseFloat(data.time) / 12) * 12);
  document.getElementById('gamesPlayed').textContent = gamesPlayed;
  
  // Set rounds completed
  document.getElementById('roundsCompleted').textContent = data.completed ? '3/3' : '2/3';
  
  // Calculate cooperation score based on time
  let coopScore = 'GOOD';
  const timeNum = parseFloat(data.time);
  if (data.completed) {
    if (data.rank === 1) coopScore = 'LEGENDARY';
    else if (timeNum < 45) coopScore = 'EXCELLENT';
    else if (timeNum < 60) coopScore = 'VERY GOOD';
    else if (timeNum < 75) coopScore = 'GOOD';
    else coopScore = 'FAIR';
  } else {
    coopScore = 'INCOMPLETE';
  }
  document.getElementById('coopScore').textContent = coopScore;
  
  // Display top 3 leaderboard
  if (data.top3 && data.top3.length > 0) {
    displayTop3Leaderboard(data.top3, data.teamName);
  }
  
  // Initialize celebration effects
  if (data.completed && !data.timeout) {
    initResultsCelebration();
  }
}

// NEW FUNCTION: Show failure screen with crash video
function showFailureScreen(data) {
  const failureScreen = document.getElementById('failureScreen');
  failureScreen.classList.add('active');
  
  // Start the crash video with improved handling
  const failureVideo = document.getElementById('failureVideo');
  if (failureVideo) {
    console.log('Attempting to play failure video...');
    
    // Reset and prepare video
    failureVideo.currentTime = 0;
    failureVideo.muted = true; // Ensure muted for autoplay
    failureVideo.loop = true;
    
    // Wait a brief moment for screen to be visible, then play
    setTimeout(() => {
      failureVideo.play()
        .then(() => {
          console.log('Failure video playing successfully');
        })
        .catch(err => {
          console.log('Video autoplay failed, attempting manual play:', err);
          // Try to load the video first
          failureVideo.load();
          setTimeout(() => {
            failureVideo.play()
              .then(() => console.log('Video playing after load'))
              .catch(e => {
                console.error('Manual play also failed:', e);
                // Last resort: try one more time
                setTimeout(() => {
                  failureVideo.play().catch(finalErr => 
                    console.error('Final play attempt failed:', finalErr)
                  );
                }, 500);
              });
          }, 200);
        });
    }, 100);
  } else {
    console.error('Failure video element not found');
  }
  
  // Set team name
  document.getElementById('teamNameDisplayFailure').textContent = data.teamName;
  
  // Set team pilots (call signs)
  const teamPilotsDisplayFailure = document.getElementById('teamPilotsDisplayFailure');
  if (teamPilotsDisplayFailure && data.players && data.players.length > 0) {
    teamPilotsDisplayFailure.textContent = `PILOTS: ${data.players.join(' & ')}`;
  }
  
  // Set failure stats
  document.getElementById('finalTimeFailure').textContent = `${parseFloat(data.time).toFixed(2)}s`;
  
  // Calculate rounds and games completed based on time
  const timeNum = parseFloat(data.time);
  const estimatedRounds = Math.min(3, Math.floor(timeNum / 25) + 1);
  const estimatedGames = Math.min(12, Math.floor(timeNum / 12));
  
  document.getElementById('roundsCompletedFailure').textContent = `${estimatedRounds - 1}/3`;
  document.getElementById('gamesCompletedFailure').textContent = `${estimatedGames}/12`;
  
  // Set failure reason
  const failureReason = document.getElementById('failureReason');
  if (data.timeout) {
    failureReason.textContent = 'TIMEOUT';
  } else {
    failureReason.textContent = 'INCOMPLETE';
  }
  
  // Display top 3 leaderboard on failure screen
  if (data.top3 && data.top3.length > 0) {
    displayTop3LeaderboardFailure(data.top3, data.teamName);
  }
}

// NEW FUNCTION: Display leaderboard on failure screen
function displayTop3LeaderboardFailure(top3, currentTeamName) {
  for (let i = 0; i < 3; i++) {
    const rank = i + 1;
    const entry = top3[i];
    
    const nameEl = document.getElementById(`topTeam${rank}NameFail`);
    const pilotsEl = document.getElementById(`topTeam${rank}PilotsFail`);
    const timeEl = document.getElementById(`topTeam${rank}TimeFail`);
    
    if (entry) {
      nameEl.textContent = entry.teamName;
      pilotsEl.textContent = `${entry.player1} & ${entry.player2}`;
      timeEl.textContent = `${entry.time.toFixed(2)}s`;
    } else {
      nameEl.textContent = '---';
      pilotsEl.textContent = 'Awaiting pilots...';
      timeEl.textContent = '--.-s';
    }
  }
}
function initResultsCelebration() {
  const confettiCanvas = document.getElementById('confettiCanvas');
  const confettiCtx = confettiCanvas.getContext('2d');
  const smokeCanvas = document.getElementById('smokeCanvas');
  const smokeCtx = smokeCanvas.getContext('2d');
  const jet = document.getElementById('blueAngelJet');
  
  if (!confettiCanvas || !smokeCanvas || !jet) {
    console.error('Canvas or jet elements not found');
    return;
  }

  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  smokeCanvas.width = window.innerWidth;
  smokeCanvas.height = window.innerHeight;

  let confetti = [];
  const colors = ['#ff0', '#0f0', '#f00', '#00f', '#ff69b4', '#ffa500'];
  
  function initConfetti() {
    confetti = [];
    for (let i = 0; i < 150; i++) {
      confetti.push({
        x: Math.random() * confettiCanvas.width,
        y: Math.random() * confettiCanvas.height - confettiCanvas.height,
        r: Math.random() * 6 + 4,
        d: Math.random() * 150,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 20) - 10,
        tiltAngleIncremental: Math.random() * 0.07 + 0.05,
        tiltAngle: 0
      });
    }
  }

  function drawConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confetti.forEach(p => {
      confettiCtx.beginPath();
      confettiCtx.lineWidth = p.r;
      confettiCtx.strokeStyle = p.color;
      confettiCtx.moveTo(p.x + p.tilt + p.r / 3, p.y);
      confettiCtx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 3);
      confettiCtx.stroke();
    });
    updateConfetti();
    requestAnimationFrame(drawConfetti);
  }

  function updateConfetti() {
    confetti.forEach(p => {
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.d);
      p.tilt = Math.sin(p.tiltAngle) * 15;
      if (p.y > confettiCanvas.height) {
        p.x = Math.random() * confettiCanvas.width;
        p.y = -20;
      }
    });
  }

  const smokeParticles = [];
  
  function createSmoke(x, y) {
    smokeParticles.push({
      x: x,
      y: y,
      alpha: 0.5 + Math.random() * 0.5,
      size: 20 + Math.random() * 20,
      rise: 0.5 + Math.random() * 1,
      fade: 0.005 + Math.random() * 0.01
    });
  }

  function updateSmoke() {
    smokeCtx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height);
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const p = smokeParticles[i];
      p.y -= p.rise;
      p.alpha -= p.fade;
      p.size += 0.2;
      if (p.alpha <= 0) smokeParticles.splice(i, 1);
      
      smokeCtx.fillStyle = `rgba(200, 200, 200, ${p.alpha})`;
      smokeCtx.beginPath();
      smokeCtx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
      smokeCtx.fill();
    }
    requestAnimationFrame(updateSmoke);
  }

  let smokingActive = false;
  
  function addSmokeAtJet() {
    if (!smokingActive) return;
    
    const rect = jet.getBoundingClientRect();
    const baseX = rect.left + rect.width * 0.25;
    const baseY = rect.top + rect.height * 0.8;
    
    createSmoke(baseX, baseY);
    createSmoke(baseX, baseY - 120);
    createSmoke(baseX, baseY - 220);
    
    requestAnimationFrame(addSmokeAtJet);
  }

  let jetFlying = false;
  
  function startFlight() {
    if (jetFlying) return;
    
    jetFlying = true;
    smokingActive = true;
    
    jet.style.animation = 'none';
    jet.offsetHeight;
    jet.classList.add('flying');
    jet.style.animation = 'flyRight 8s linear forwards';
    
    addSmokeAtJet();
    
    const jetSound = document.getElementById('jetSound');
    if (jetSound) {
      jetSound.currentTime = 0;
      jetSound.volume = 0.5;
      jetSound.play().catch(err => console.log('Could not play jet sound:', err));
    }
    
    setTimeout(() => {
      jetFlying = false;
      smokingActive = false;
      jet.classList.remove('flying');
      
      setTimeout(() => {
        startFlight();
      }, 5000);
    }, 8000);
  }

  window.addEventListener('resize', () => {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    smokeCanvas.width = window.innerWidth;
    smokeCanvas.height = window.innerHeight;
  });

  initConfetti();
  drawConfetti();
  updateSmoke();
  
  setTimeout(() => {
    startFlight();
  }, 500);
}

socket.on('partnerDisconnected', (data) => {
  console.log('Partner disconnected:', data);
  alert(`PLAYER ${data.color.toUpperCase()} HAS DISCONNECTED! MISSION ABORTED.`);
  if (partnerCursors[data.color]) {
    partnerCursors[data.color].remove();
    delete partnerCursors[data.color];
  }
  
  removeOwnCursor();
  
  setTimeout(() => {
    window.location.reload();
  }, 3000);
});

// Mouse movement
document.addEventListener('mousemove', (e) => {
  if (room && color) {
    const now = Date.now();
    if (now - lastEmitTime > GAME_CONSTANTS.MOUSE_EMIT_THROTTLE) {
      // Use viewport dimensions only (not document) for perfect sync
      // clientX/clientY are relative to viewport, which is what we want
      const xPercent = (e.clientX / window.innerWidth) * 100;
      const yPercent = (e.clientY / window.innerHeight) * 100;
      
      socket.emit('mouseMove', {
        room,
        color,
        x: xPercent,
        y: yPercent
      });
      lastEmitTime = now;
    }
    
    updateOwnCursorPosition(e);
  }
});

socket.on('partnerMouse', (data) => {
  if (data.color === color) return;

  if (!partnerCursors[data.color]) {
    const cursor = document.createElement('div');
    cursor.className = `partner-cursor ${data.color}`;
    cursor.style.position = 'fixed'; // Fixed to viewport
    cursor.style.width = '22px';
    cursor.style.height = '22px';
    cursor.style.borderRadius = '50%';
    cursor.style.pointerEvents = 'none';
    cursor.style.zIndex = '9999';
    cursor.style.transition = 'all 0.05s linear'; // Smoother, faster transition
    cursor.style.backgroundColor = getColorHex(data.color);
    cursor.style.border = '2px solid #000';
    
    document.body.appendChild(cursor);
    partnerCursors[data.color] = cursor;
  }

  const cursor = partnerCursors[data.color];
  
  // Convert percentages back to pixels based on viewport dimensions
  const xPixels = (data.x / 100) * window.innerWidth;
  const yPixels = (data.y / 100) * window.innerHeight;
  
  cursor.style.left = `${xPixels - 11}px`;
  cursor.style.top = `${yPixels - 11}px`;
});

// NEW: Listen for partner's game actions
socket.on('partnerGameAction', (data) => {
  console.log('Partner game action:', data);
  
  // Find partner's section (the one that's NOT mine)
  const partnerSection = sectionIndex === 1 ? 2 : 1;
  
  // Apply the action to the partner's section
  applyPartnerAction(partnerSection, data);
});

// Enter key support for username
document.getElementById('usernameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitUsername();
  }
});

// Initialize voice when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('U.S. Naval Cooperation Test initialized');
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = initializeVoice;
  }
  initializeVoice();
  
  // Preload the failure video
  const failureVideo = document.getElementById('failureVideo');
  if (failureVideo) {
    console.log('Preloading failure video...');
    failureVideo.load();
    failureVideo.addEventListener('canplaythrough', () => {
      console.log('Failure video ready to play');
    });
    failureVideo.addEventListener('error', (e) => {
      console.error('Error loading failure video:', e);
    });
  }
  
  document.getElementById('usernameInput').focus();
  
  // NEW: Add room code input listener for live preview
  const roomCodeInput = document.getElementById('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.addEventListener('input', (e) => {
      const roomCode = e.target.value.trim().toUpperCase();
      previewRoom(roomCode);
    });
    
    // Also trigger preview on focus if there's already a value
    roomCodeInput.addEventListener('focus', (e) => {
      const roomCode = e.target.value.trim().toUpperCase();
      if (roomCode) {
        previewRoom(roomCode);
      }
    });
  }
  
  // Play Again button
  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      removeOwnCursor();
      window.location.reload();
    });
  }
  
  // Retry button for failure screen
  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      removeOwnCursor();
      window.location.reload();
    });
  }
});

// ====================================================================
// ROOM CODE FUNCTIONALITY
// ====================================================================

function showRoomCodeBanner() {
  const banner = document.getElementById('roomCodeBanner');
  const roomCodeValue = document.getElementById('roomCodeValue');
  const roomCodeDisplayLarge = document.getElementById('roomCodeDisplayLarge');
  
  if (banner && room) {
    roomCodeValue.textContent = room;
    banner.classList.add('active');
    
    if (roomCodeDisplayLarge) {
      roomCodeDisplayLarge.textContent = room;
    }
  }
}

function copyRoomCode() {
  if (!room) return;
  
  navigator.clipboard.writeText(room).then(() => {
    const btn = document.getElementById('copyRoomCode');
    const originalText = btn.textContent;
    btn.textContent = 'COPIED!';
    btn.style.background = '#00ff00';
    btn.style.color = '#000';
    
    playSound('correctSound');
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy room code:', err);
    alert(`Room Code: ${room}`);
  });
}

// ====================================================================
// SOUND EFFECTS
// ====================================================================

function playSound(soundId) {
  const sound = document.getElementById(soundId);
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(err => {
      console.log('Could not play sound:', err);
    });
  }
}

// ====================================================================
// TOP 3 LEADERBOARD DISPLAY
// ====================================================================

function displayTop3Leaderboard(top3Teams, currentTeamName) {
  console.log('Displaying top 3 leaderboard:', top3Teams);
  
  for (let i = 0; i < 3; i++) {
    const rank = i + 1;
    const teamNameEl = document.getElementById(`topTeam${rank}Name`);
    const pilotsEl = document.getElementById(`topTeam${rank}Pilots`);
    const timeEl = document.getElementById(`topTeam${rank}Time`);
    const entryEl = teamNameEl?.closest('.leaderboard-entry');
    
    if (!teamNameEl || !pilotsEl || !timeEl) continue;
    
    if (top3Teams[i]) {
      const team = top3Teams[i];
      
      teamNameEl.textContent = team.teamName;
      
      if (team.players && team.players.length > 0) {
        pilotsEl.textContent = team.players.join(' & ');
      } else {
        pilotsEl.textContent = 'Classified';
      }
      
      timeEl.textContent = `${team.time.toFixed(2)}s`;
      
      if (entryEl && team.teamName === currentTeamName) {
        entryEl.classList.add('current-team');
      } else if (entryEl) {
        entryEl.classList.remove('current-team');
      }
      
      if (entryEl) {
        entryEl.classList.remove('empty');
      }
    } else {
      teamNameEl.textContent = 'NO TEAM';
      pilotsEl.textContent = 'Awaiting elite pilots...';
      timeEl.textContent = '--.-s';
      
      if (entryEl) {
        entryEl.classList.add('empty');
        entryEl.classList.remove('current-team');
      }
    }
  }
}
// ===== RE-ENGAGE WITH TEAM FUNCTIONALITY =====

function reengageWithTeam() {
  console.log('Re-engage button clicked');
  
  if (!room || !color) {
    console.error('No room or color assigned');
    return;
  }
  
  if (reengageRequested) {
    console.log('Already requested re-engage');
    return;
  }
  
  reengageRequested = true;
  
  // Hide both buttons, show waiting status
  const reengageBtn = document.getElementById('reengageBtn');
  const reengageBtnFail = document.getElementById('reengageBtnFail');
  const reengageStatus = document.getElementById('reengageStatus');
  const reengageStatusFail = document.getElementById('reengageStatusFail');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const retryBtn = document.getElementById('retryBtn');
  
  if (reengageBtn) {
    reengageBtn.classList.add('waiting');
    reengageBtn.disabled = true;
    reengageBtn.style.display = 'none';
  }
  if (reengageBtnFail) {
    reengageBtnFail.classList.add('waiting');
    reengageBtnFail.disabled = true;
    reengageBtnFail.style.display = 'none';
  }
  if (playAgainBtn) playAgainBtn.style.display = 'none';
  if (retryBtn) retryBtn.style.display = 'none';
  if (reengageStatus) reengageStatus.style.display = 'flex';
  if (reengageStatusFail) reengageStatusFail.style.display = 'flex';
  
  // Emit re-engage request to server
  socket.emit('requestReengage', { room, color });
  console.log('Sent re-engage request to server');
}

socket.on('partnerReengaged', (data) => {
  console.log('Partner has re-engaged!', data);
  partnerReengaged = true;
  
  // Update status to show partner is ready
  const statusText = document.querySelectorAll('.status-text');
  statusText.forEach(el => {
    el.textContent = 'PARTNER READY! RESTARTING...';
    el.style.color = '#00ff00';
  });
});

socket.on('bothReengaged', (data) => {
  console.log('Both players re-engaged! Restarting game...', data);
  
  // Show restart message
  const statusText = document.querySelectorAll('.status-text');
  statusText.forEach(el => {
    el.textContent = 'BOTH READY! MISSION RESTART IN 3...';
    el.style.color = '#00ff00';
  });
  
  // Countdown before restart
  let countdown = 3;
  const countdownInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      statusText.forEach(el => {
        el.textContent = `BOTH READY! MISSION RESTART IN ${countdown}...`;
      });
    } else {
      clearInterval(countdownInterval);
      // Reset game state and go back to color confirmation
      resetGameState();
      showScreen('colorConfirmationScreen');
    }
  }, 1000);
});

socket.on('reengageCancelled', (data) => {
  console.log('Re-engage cancelled:', data.reason);
  
  // Show cancellation message
  const statusText = document.querySelectorAll('.status-text');
  statusText.forEach(el => {
    el.textContent = data.reason || 'RE-ENGAGE CANCELLED';
    el.style.color = '#ff4444';
  });
  
  // Reset after 2 seconds
  setTimeout(() => {
    reengageRequested = false;
    partnerReengaged = false;
    
    const reengageBtn = document.getElementById('reengageBtn');
    const reengageBtnFail = document.getElementById('reengageBtnFail');
    const reengageStatus = document.getElementById('reengageStatus');
    const reengageStatusFail = document.getElementById('reengageStatusFail');
    const playAgainBtn = document.getElementById('playAgainBtn');
    const retryBtn = document.getElementById('retryBtn');
    
    if (reengageBtn) {
      reengageBtn.classList.remove('waiting');
      reengageBtn.disabled = false;
      reengageBtn.style.display = 'flex';
    }
    if (reengageBtnFail) {
      reengageBtnFail.classList.remove('waiting');
      reengageBtnFail.disabled = false;
      reengageBtnFail.style.display = 'flex';
    }
    if (playAgainBtn) playAgainBtn.style.display = 'block';
    if (retryBtn) retryBtn.style.display = 'block';
    if (reengageStatus) reengageStatus.style.display = 'none';
    if (reengageStatusFail) reengageStatusFail.style.display = 'none';
  }, 2000);
});

function resetGameState() {
  // Reset all game variables
  reengageRequested = false;
  partnerReengaged = false;
  startTime = null;
  countdown = GAME_CONSTANTS.INITIAL_COUNTDOWN;
  currentSequenceNumber = 1;
  
  // Clear intervals
  clearInterval(timerInterval);
  clearInterval(countdownInterval);
  clearInterval(numberSequenceInterval);
  timerInterval = null;
  countdownInterval = null;
  numberSequenceInterval = null;
  
  // Hide all screens except lobby
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
}

// ===== END RE-ENGAGE FUNCTIONALITY =====