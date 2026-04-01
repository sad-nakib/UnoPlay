import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { nanoid } from 'nanoid';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { Card, Color, Value, GameState, Player, ServerToClientEvents, ClientToServerEvents } from './src/types.ts';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
  },
});

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

const PORT = 3000;

// Helper to sync room to Firestore
async function saveRoom(room: GameState) {
  try {
    await setDoc(doc(db, 'rooms', room.roomId), room);
  } catch (e) {
    console.error('Error saving room to Firestore:', e);
  }
}

async function getRoom(roomId: string): Promise<GameState | null> {
  try {
    const docSnap = await getDoc(doc(db, 'rooms', roomId.toUpperCase()));
    if (docSnap.exists()) {
      return docSnap.data() as GameState;
    }
  } catch (e) {
    console.error('Error getting room from Firestore:', e);
  }
  return null;
}

async function deleteRoom(roomId: string) {
  try {
    await deleteDoc(doc(db, 'rooms', roomId));
  } catch (e) {
    console.error('Error deleting room from Firestore:', e);
  }
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  const colors: Color[] = ['red', 'blue', 'green', 'yellow'];
  const values: Value[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];

  for (const color of colors) {
    for (const value of values) {
      const count = value === '0' ? 1 : 2;
      for (let i = 0; i < count; i++) {
        deck.push({ id: nanoid(), color, value });
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ id: nanoid(), color: 'wild', value: 'wild' });
    deck.push({ id: nanoid(), color: 'wild', value: 'wild4' });
  }

  return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function getNextPlayerIndex(currentIndex: number, direction: 1 | -1, playerCount: number): number {
  let nextIndex = currentIndex + direction;
  if (nextIndex >= playerCount) nextIndex = 0;
  if (nextIndex < 0) nextIndex = playerCount - 1;
  return nextIndex;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', async (name) => {
    const roomId = nanoid(6).toUpperCase();
    const gameState: GameState = {
      roomId,
      players: [{ id: socket.id, name, hand: [], isReady: true }],
      deck: createDeck(),
      discardPile: [],
      currentPlayerIndex: 0,
      direction: 1,
      status: 'lobby',
      winner: null,
      lastAction: `${name} created the room`,
      currentEffect: 'none',
      wildColor: null,
    };
    await saveRoom(gameState);
    socket.join(roomId);
    socket.emit('room_state', gameState);
  });

  socket.on('join_room', async (roomId, name) => {
    const room = await getRoom(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.status !== 'lobby') {
      socket.emit('error', 'Game already in progress');
      return;
    }
    if (room.players.length >= 10) {
      socket.emit('error', 'Room is full');
      return;
    }

    room.players.push({ id: socket.id, name, hand: [], isReady: true });
    room.lastAction = `${name} joined the room`;
    await saveRoom(room);
    socket.join(roomId.toUpperCase());
    io.to(roomId.toUpperCase()).emit('room_state', room);
  });

  socket.on('start_game', async () => {
    const roomId = Array.from(socket.rooms).find(r => r.length === 6);
    if (!roomId) return;
    const room = await getRoom(roomId);
    if (!room) return;

    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players to start');
      return;
    }

    room.status = 'playing';
    room.deck = createDeck();
    room.discardPile = [];
    
    for (const player of room.players) {
      player.hand = room.deck.splice(0, 7);
    }

    let initialCardIndex = room.deck.findIndex(c => c.value !== 'wild4');
    const initialCard = room.deck.splice(initialCardIndex, 1)[0];
    room.discardPile.push(initialCard);
    
    if (initialCard.value === 'skip') {
      room.currentPlayerIndex = getNextPlayerIndex(0, room.direction, room.players.length);
    } else if (initialCard.value === 'reverse') {
      if (room.players.length === 2) {
        room.currentPlayerIndex = getNextPlayerIndex(0, room.direction, room.players.length);
      } else {
        room.direction *= -1;
        room.currentPlayerIndex = 0;
      }
    } else if (initialCard.value === 'draw2') {
      room.currentEffect = 'draw2';
    } else if (initialCard.value === 'wild') {
      room.wildColor = null;
    }

    room.lastAction = 'Game started!';
    await saveRoom(room);
    io.to(roomId).emit('room_state', room);
  });

  socket.on('play_card', async (cardId, wildColor) => {
    const roomId = Array.from(socket.rooms).find(r => r.length === 6);
    if (!roomId) return;
    const room = await getRoom(roomId);
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    const card = player.hand[cardIndex];

    const topCard = room.discardPile[room.discardPile.length - 1];
    const currentColor = room.wildColor || topCard.color;

    let canPlay = false;
    if (card.color === 'wild' || card.color === currentColor || card.value === topCard.value) {
      canPlay = true;
    }

    if (!canPlay) {
      socket.emit('error', 'Invalid move');
      return;
    }

    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);
    room.wildColor = wildColor || null;
    room.lastAction = `${player.name} played ${card.color} ${card.value}`;

    if (player.hand.length === 0) {
      room.status = 'ended';
      room.winner = player.name;
      await saveRoom(room);
      io.to(roomId).emit('room_state', room);
      return;
    }

    let skipNext = false;
    if (card.value === 'skip') {
      skipNext = true;
    } else if (card.value === 'reverse') {
      if (room.players.length === 2) {
        skipNext = true;
      } else {
        room.direction *= -1;
      }
    } else if (card.value === 'draw2') {
      room.currentEffect = 'draw2';
    } else if (card.value === 'wild4') {
      room.currentEffect = 'draw4';
    }

    room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
    if (skipNext) {
      room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
    }

    if (room.currentEffect === 'draw2') {
      const nextPlayer = room.players[room.currentPlayerIndex];
      const drawn = room.deck.splice(0, 2);
      nextPlayer.hand.push(...drawn);
      room.currentEffect = 'none';
      room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
      room.lastAction += `. ${nextPlayer.name} drew 2 cards and was skipped.`;
    } else if (room.currentEffect === 'draw4') {
      const nextPlayer = room.players[room.currentPlayerIndex];
      const drawn = room.deck.splice(0, 4);
      nextPlayer.hand.push(...drawn);
      room.currentEffect = 'none';
      room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
      room.lastAction += `. ${nextPlayer.name} drew 4 cards and was skipped.`;
    }

    if (room.deck.length < 10) {
      const top = room.discardPile.pop()!;
      room.deck.push(...shuffle(room.discardPile));
      room.discardPile = [top];
    }

    await saveRoom(room);
    io.to(roomId).emit('room_state', room);
  });

  socket.on('draw_card', async () => {
    const roomId = Array.from(socket.rooms).find(r => r.length === 6);
    if (!roomId) return;
    const room = await getRoom(roomId);
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    const drawn = room.deck.splice(0, 1)[0];
    player.hand.push(drawn);
    room.lastAction = `${player.name} drew a card`;

    room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);

    if (room.deck.length < 10) {
      const top = room.discardPile.pop()!;
      room.deck.push(...shuffle(room.discardPile));
      room.discardPile = [top];
    }

    await saveRoom(room);
    io.to(roomId).emit('room_state', room);
  });

  socket.on('leave_room', async () => {
    const roomId = Array.from(socket.rooms).find(r => r.length === 6);
    if (roomId) {
      const room = await getRoom(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          await deleteRoom(roomId);
        } else {
          room.lastAction = `Someone left the room`;
          if (room.status === 'playing') {
            room.status = 'ended';
            room.winner = 'Remaining players (someone left)';
          }
          await saveRoom(room);
          io.to(roomId).emit('room_state', room);
        }
      }
      socket.leave(roomId);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    const roomsSnap = await getDocs(collection(db, 'rooms'));
    for (const doc of roomsSnap.docs) {
      const room = doc.data() as GameState;
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          await deleteRoom(room.roomId);
        } else {
          room.lastAction = `Someone disconnected`;
          if (room.status === 'playing') {
            room.status = 'ended';
            room.winner = 'Remaining players (someone disconnected)';
          }
          await saveRoom(room);
          io.to(room.roomId).emit('room_state', room);
        }
      }
    }
  });
});

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
