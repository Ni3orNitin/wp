if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
}

// --- DOM Elements ---
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput"); 
const muteMicBtn = document.getElementById("muteMicBtn");
const muteSpeakerBtn = document.getElementById("muteSpeakerBtn");
const endCallBtn = document.getElementById("endCallBtn");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

// YouTube Specific Elements/Buttons
const youtubeWatchBtn = document.getElementById("youtubeWatchBtn");
const gameTitle = document.getElementById("gameTitle");
const gameContent = document.getElementById("gameContent");

// --- Global State ---
let localStream;
let peerConnection;
let isInitiator = false;
let signalingSocket;
let username = "User" + Math.floor(Math.random() * 1000);
let currentRoomId = null;

// --- WebRTC Constants ---
const signalingServerUrl = "wss://webrtc-ttt.onrender.com";
const iceServers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" }
    ]
};

// --- YouTube Watch Party Variables ---
let player;
let currentVideoId = "dQw4w9WgXcQ"; // Default Video ID
let ignoreSync = false;


// ==========================================================
// 🔴 WEB RTC CORE FUNCTIONS (Video Call)
// ==========================================================

async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log("✅ Local camera started.");
        return localStream;
    } catch (err) {
        console.error("❌ Failed to get local media stream:", err);
        throw err;
    }
}

async function createPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log("✅ Remote stream received.");
        }
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // Send ICE candidate with Room ID
            signalingSocket.send(JSON.stringify({ type: "candidate", candidate: event.candidate, roomId: currentRoomId }));
        }
    };
}

async function startCall(initiator) {
    isInitiator = initiator;
    await createPeerConnection();
    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        // Send Offer with Room ID
        signalingSocket.send(JSON.stringify({ type: 'offer', offer: offer, roomId: currentRoomId }));
    }
}

async function joinCall() {
    currentRoomId = roomInput.value.trim();

    if (!currentRoomId) {
        alert("Please enter a unique Room ID to join/create.");
        return;
    }

    try {
        await startLocalStream();
        signalingSocket = new WebSocket(signalingServerUrl);
        
        signalingSocket.onopen = () => {
            console.log("✅ Connected to signaling server.");
            // Send client_ready with Room ID
            signalingSocket.send(JSON.stringify({ 
                type: 'client_ready', 
                username: username, 
                roomId: currentRoomId 
            }));
        };
        
        signalingSocket.onmessage = async (message) => {
            const data = JSON.parse(message.data);
            switch (data.type) {
                case 'peer_connected':
                    startCall(true); // Start call as initiator
                    break;
                case 'offer':
                    startCall(false); // Respond to offer
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    // Send Answer with Room ID
                    signalingSocket.send(JSON.stringify({ type: 'answer', answer: answer, roomId: currentRoomId }));
                    break;
                case 'answer':
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    break;
                case 'candidate':
                    if (data.candidate) {
                        try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (err) { console.error("❌ Error adding received ICE candidate:", err); }
                    }
                    break;
                case 'chat_message':
                    displayChatMessage(data.username, data.message);
                    break;
                case 'youtube_sync':
                    applyYouTubeState(data);
                    break;
                case 'end_call':
                    console.log("❌ Remote peer ended the call.");
                    endCall();
                    break;
            }
        };

        // Update UI
        joinBtn.classList.add('hidden');
        roomInput.classList.add('hidden');
        muteMicBtn.classList.remove('hidden');
        muteSpeakerBtn.classList.remove('hidden');
        endCallBtn.classList.remove('hidden');
        console.log(`Joined room ${currentRoomId}. Streams are active.`);
    } catch (err) {
        console.error("❌ Could not join call:", err);
    }
}

async function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    
    // Reset UI state
    joinBtn.classList.remove('hidden');
    roomInput.classList.remove('hidden');
    muteMicBtn.classList.add('hidden');
    muteSpeakerBtn.classList.add('hidden');
    endCallBtn.classList.add('hidden');
    isInitiator = false;
    
    if (signalingSocket) {
        signalingSocket.send(JSON.stringify({ type: 'end_call', roomId: currentRoomId }));
        signalingSocket.close();
        signalingSocket = null;
    }
    currentRoomId = null; 
    
    if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
        player.destroy();
        player = null;
    }
    console.log("❌ Call ended.");
}


// ==========================================================
// 🎙️ MEDIA CONTROLS
// ==========================================================

function toggleAudio() {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteMicBtn.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
        muteMicBtn.classList.toggle('active', !audioTrack.enabled);
    }
}

// NOTE: toggleVideo function removed as there is no button for it in the HTML,
// but included the basic Mute/Unmute Mic/Speaker logic.

// ==========================================================
// 💬 CHAT LOGIC
// ==========================================================

function displayChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        // Send chat message with Room ID
        signalingSocket.send(JSON.stringify({
            type: 'chat_message',
            username: username,
            message: message,
            roomId: currentRoomId
        }));
        chatInput.value = '';
    }
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});


// ==========================================================
// 📺 YOUTUBE WATCH PARTY (Shared Control)
// ==========================================================

function onYouTubeIframeAPIReady() {
    console.log("✅ YouTube IFrame API Ready.");
    if (document.getElementById('youtube-player')) {
        createYouTubePlayer(currentVideoId);
    }
}

function createYouTubePlayer(videoId) {
    if (player) {
        player.destroy();
    }
    player = new YT.Player('youtube-player', {
        height: '360',
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'rel': 0 },
        events: {
            'onReady': () => console.log("✅ YouTube Player Ready."),
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    if (ignoreSync || !signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
        ignoreSync = false;
        return;
    }

    let state = event.data;
    let currentTime = player.getCurrentTime();

    // Broadcast sync message for play (1), pause (2), or buffering (3)
    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
        sendYouTubeState(currentVideoId, state, currentTime);
    }
}

function sendYouTubeState(videoId, playerState, currentTime) {
    signalingSocket.send(JSON.stringify({
        type: 'youtube_sync',
        videoId: videoId,
        state: playerState,
        time: currentTime,
        timestamp: Date.now(),
        roomId: currentRoomId // PASS ROOM ID
    }));
}

function applyYouTubeState(data) {
    const { videoId, state, time, timestamp } = data;
    
    if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        loadYouTubeWatchParty(videoId);
        return; 
    }

    if (!player || typeof player.loadVideoById !== 'function') return;
    
    const latency = (Date.now() - timestamp) / 1000; 
    let syncTime = time + latency; 

    ignoreSync = true; 

    if (state === YT.PlayerState.PLAYING) {
        player.seekTo(syncTime, true);
        player.playVideo();
    } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
        player.pauseVideo();
        player.seekTo(syncTime, true); 
    } else if (state === YT.PlayerState.ENDED) {
        player.stopVideo();
    }
}

function loadYouTubeWatchParty(videoId = currentVideoId) {
    gameTitle.textContent = "YouTube Watch Party";
    gameContent.innerHTML = `
        <div id="youtube-player-container" style="width: 100%; max-width: 640px; margin: 0 auto; position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
            <div id="youtube-player" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>
        </div>
        <div class="youtube-controls" style="margin-top: 20px; display: flex; gap: 10px;">
            <input type="text" id="videoIdInput" placeholder="Video ID or URL" style="padding: 10px; flex-grow: 1; border-radius: 8px; border: 1px solid #444; background: #333; color: #fff;">
            <button id="loadVideoBtn" class="game-btn" style="background-color: #e53935;">Load Video</button>
        </div>
        <p style="margin-top: 15px; color: #bdbdbd;">Control is **shared**. Anyone can play, pause, or seek the video.</p>
    `;
    
    const inputField = gameContent.querySelector('#videoIdInput');
    inputField.value = videoId;

    gameContent.querySelector('#loadVideoBtn').addEventListener('click', handleLoadVideo);

    if (window.YT && window.YT.Player) {
        createYouTubePlayer(videoId);
    } 
}

function handleLoadVideo() {
    const input = document.getElementById('videoIdInput').value;
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\w*[\/\?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = input.match(regex);
    let newVideoId;

    if (match && match[1]) {
        newVideoId = match[1];
    } else if (input.length === 11) {
        newVideoId = input;
    } else {
        alert("Invalid YouTube URL or Video ID.");
        return;
    }

    currentVideoId = newVideoId;
    
    if (player && typeof player.loadVideoById === 'function') {
        player.loadVideoById(currentVideoId);
    } else {
         loadYouTubeWatchParty(currentVideoId);
    }
    
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        sendYouTubeState(currentVideoId, YT.PlayerState.PAUSED, 0); 
    }
}


// ==========================================================
// 🖱️ EVENT LISTENERS
// ==========================================================

// Attach to the new room setup
joinBtn.addEventListener('click', joinCall);
muteMicBtn.addEventListener('click', toggleAudio);
endCallBtn.addEventListener('click', endCall);
muteSpeakerBtn.addEventListener('click', () => {
    if (!remoteVideo || !remoteVideo.srcObject) return;
    const remoteStream = remoteVideo.srcObject;
    const audioTrack = remoteStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteSpeakerBtn.textContent = audioTrack.enabled ? 'Mute Speaker' : 'Unmute Speaker';
    }
});

// Load the YouTube interface
youtubeWatchBtn.addEventListener('click', () => loadYouTubeWatchParty());