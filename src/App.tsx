import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Play, LogOut, Plus, UserPlus, ArrowRight, Trophy, AlertCircle, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { Card, Color, GameState, Player, Value } from './types';
import { nanoid } from 'nanoid';

// Supabase Configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kinejwtucyljtnzvhthd.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_0JTFjluiQJOImQFwYa04Cw_tdMLTGYy';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const UnoCard: React.FC<{ 
  card: Card; 
  onClick?: () => void; 
  disabled?: boolean; 
  isCurrent?: boolean;
  isBack?: boolean;
  className?: string;
}> = ({ card, onClick, disabled, isCurrent, isBack, className }) => {
  const getColorClass = (color: Color) => {
    switch (color) {
      case 'red': return 'bg-red-500';
      case 'blue': return 'bg-blue-500';
      case 'green': return 'bg-green-500';
      case 'yellow': return 'bg-yellow-500';
      case 'wild': return 'bg-gray-900';
      default: return 'bg-gray-400';
    }
  };

  if (isBack) {
    return (
      <div className={`w-16 h-24 sm:w-20 sm:h-32 bg-red-800 rounded-xl border-2 sm:border-4 border-white flex items-center justify-center shadow-lg ${className || ''}`}>
        <div className="w-12 h-20 sm:w-14 sm:h-24 bg-red-900 rounded-lg flex items-center justify-center">
          <span className="text-white font-black text-lg sm:text-xl rotate-45">UNO</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      whileHover={!disabled ? { y: -5, scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`relative w-16 h-24 sm:w-20 sm:h-32 ${getColorClass(card.color)} rounded-xl border-2 sm:border-4 border-white flex flex-col items-center justify-center shadow-lg cursor-pointer transition-all ${disabled ? 'opacity-60 cursor-not-allowed' : 'z-10 hover:shadow-2xl'} ${isCurrent ? 'ring-4 ring-yellow-300' : ''} ${className || ''}`}
    >
      <div className="absolute top-1 left-1 text-white font-black text-xs sm:text-sm">{card.value}</div>
      <div className="w-10 h-16 sm:w-14 sm:h-24 bg-white/20 rounded-full flex items-center justify-center">
        <span className="text-white font-black text-xl sm:text-3xl drop-shadow-md select-none">
          {card.value === 'skip' && '⊘'}
          {card.value === 'reverse' && '⇄'}
          {card.value === 'draw2' && '+2'}
          {card.value === 'wild' && 'W'}
          {card.value === 'wild4' && '+4'}
          {parseInt(card.value) >= 0 && card.value}
        </span>
      </div>
      <div className="absolute bottom-1 right-1 text-white font-black text-xs sm:text-sm rotate-180">{card.value}</div>
    </motion.div>
  );
};

interface AnimatingCard {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

// Game Logic Helpers
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

export default function App() {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [prevPlayers, setPrevPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWildPicker, setShowWildPicker] = useState<{ cardId: string } | null>(null);
  const [animatingCards, setAnimatingCards] = useState<AnimatingCard[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [myId] = useState(() => nanoid());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const drawPileRef = useRef<HTMLDivElement>(null);
  const myHandRef = useRef<HTMLDivElement>(null);
  const playerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const syncState = async (newState: GameState) => {
    setGameState(newState);
    const { error } = await supabase
      .from('rooms')
      .upsert({ id: newState.roomId, state: newState });
    
    if (error) {
      console.error('Sync Error:', error);
      setError('Failed to sync game state');
    } else {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'state_update',
        payload: newState
      });
    }
  };

  useEffect(() => {
    if (!gameState?.roomId) return;

    const channel = supabase.channel(`room:${gameState.roomId}`, {
      config: { broadcast: { self: false } }
    });

    channel
      .on('broadcast', { event: 'state_update' }, ({ payload }) => {
        setGameState(prevState => {
          if (prevState) setPrevPlayers(prevState.players);
          return payload;
        });
      })
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [gameState?.roomId]);

  useEffect(() => {
    if (!gameState || prevPlayers.length === 0) return;

    const newAnimatingCards: AnimatingCard[] = [];
    const drawPileRect = drawPileRef.current?.getBoundingClientRect();

    if (!drawPileRect) return;

    gameState.players.forEach(player => {
      const prevPlayer = prevPlayers.find(p => p.id === player.id);
      if (prevPlayer && player.hand.length > prevPlayer.hand.length) {
        const diff = player.hand.length - prevPlayer.hand.length;
        
        let endRect: DOMRect | undefined;
        if (player.id === myId) {
          endRect = myHandRef.current?.getBoundingClientRect();
        } else {
          endRect = playerRefs.current[player.id]?.getBoundingClientRect();
        }

        if (endRect) {
          for (let i = 0; i < diff; i++) {
            newAnimatingCards.push({
              id: `${player.id}-${Date.now()}-${i}`,
              start: { x: drawPileRect.left, y: drawPileRect.top },
              end: { x: endRect.left + (endRect.width / 2) - 40, y: endRect.top + (endRect.height / 2) - 64 }
            });
          }
        }
      }
    });

    if (newAnimatingCards.length > 0) {
      setAnimatingCards(prev => [...prev, ...newAnimatingCards]);
      setTimeout(() => {
        setAnimatingCards(prev => prev.filter(c => !newAnimatingCards.find(nc => nc.id === c.id)));
      }, 800);
    }
  }, [gameState, prevPlayers, myId]);

  const handleCreateRoom = async () => {
    if (!name) return setError('Please enter your name');
    const newRoomId = nanoid(6).toUpperCase();
    const initialState: GameState = {
      roomId: newRoomId,
      players: [{ id: myId, name, hand: [], isReady: true }],
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
    await syncState(initialState);
  };

  const handleJoinRoom = async () => {
    if (!name || !roomId) return setError('Please enter name and room ID');
    const { data, error } = await supabase
      .from('rooms')
      .select('state')
      .eq('id', roomId.toUpperCase())
      .single();

    if (error || !data) return setError('Room not found');
    const room = data.state as GameState;

    if (room.status !== 'lobby') return setError('Game already in progress');
    if (room.players.length >= 10) return setError('Room is full');

    room.players.push({ id: myId, name, hand: [], isReady: true });
    room.lastAction = `${name} joined the room`;
    await syncState(room);
  };

  const handleStartGame = async () => {
    if (!gameState) return;
    if (gameState.players.length < 2) return setError('Need at least 2 players');

    const room = { ...gameState };
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
    }

    room.lastAction = 'Game started!';
    await syncState(room);
  };

  const handlePlayCard = async (card: Card) => {
    if (!gameState) return;
    if (card.color === 'wild') {
      setShowWildPicker({ cardId: card.id });
    } else {
      executePlayCard(card.id);
    }
  };

  const executePlayCard = async (cardId: string, wildColor?: Color) => {
    if (!gameState) return;
    const room = { ...gameState };
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== myId) return setError('Not your turn');

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    const card = player.hand[cardIndex];

    const topCard = room.discardPile[room.discardPile.length - 1];
    const currentColor = room.wildColor || topCard.color;

    if (card.color !== 'wild' && card.color !== currentColor && card.value !== topCard.value) {
      return setError('Invalid move');
    }

    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);
    room.wildColor = wildColor || null;
    room.lastAction = `${player.name} played ${card.color} ${card.value}`;

    if (player.hand.length === 0) {
      room.status = 'ended';
      room.winner = player.name;
      await syncState(room);
      return;
    }

    let skipNext = false;
    if (card.value === 'skip') skipNext = true;
    else if (card.value === 'reverse') {
      if (room.players.length === 2) skipNext = true;
      else room.direction *= -1;
    } else if (card.value === 'draw2') room.currentEffect = 'draw2';
    else if (card.value === 'wild4') room.currentEffect = 'draw4';

    room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
    if (skipNext) room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);

    if (room.currentEffect === 'draw2') {
      const nextPlayer = room.players[room.currentPlayerIndex];
      nextPlayer.hand.push(...room.deck.splice(0, 2));
      room.currentEffect = 'none';
      room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
      room.lastAction += `. ${nextPlayer.name} drew 2 and was skipped.`;
    } else if (room.currentEffect === 'draw4') {
      const nextPlayer = room.players[room.currentPlayerIndex];
      nextPlayer.hand.push(...room.deck.splice(0, 4));
      room.currentEffect = 'none';
      room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);
      room.lastAction += `. ${nextPlayer.name} drew 4 and was skipped.`;
    }

    if (room.deck.length < 10) {
      const top = room.discardPile.pop()!;
      room.deck.push(...shuffle(room.discardPile));
      room.discardPile = [top];
    }

    await syncState(room);
  };

  const handleWildPick = (color: Color) => {
    if (showWildPicker) {
      executePlayCard(showWildPicker.cardId, color);
      setShowWildPicker(null);
    }
  };

  const handleDrawCard = async () => {
    if (!gameState) return;
    const room = { ...gameState };
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== myId) return setError('Not your turn');

    player.hand.push(room.deck.splice(0, 1)[0]);
    room.lastAction = `${player.name} drew a card`;
    room.currentPlayerIndex = getNextPlayerIndex(room.currentPlayerIndex, room.direction, room.players.length);

    if (room.deck.length < 10) {
      const top = room.discardPile.pop()!;
      room.deck.push(...shuffle(room.discardPile));
      room.discardPile = [top];
    }

    await syncState(room);
  };

  const handleLeaveRoom = () => {
    setGameState(null);
    setPrevPlayers([]);
  };

  const currentPlayer = useMemo(() => {
    return gameState?.players.find(p => p.id === myId);
  }, [gameState, myId]);

  const isMyTurn = useMemo(() => {
    if (!gameState) return false;
    return gameState.players[gameState.currentPlayerIndex].id === myId;
  }, [gameState, myId]);

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-600 via-yellow-500 to-blue-600 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 bg-red-600 rounded-2xl flex items-center justify-center shadow-lg mb-4 rotate-3">
              <span className="text-white font-black text-3xl">UNO</span>
            </div>
            <h1 className="text-3xl font-black text-gray-800 tracking-tight">Online Multiplayer</h1>
            <div className="mt-2 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full bg-green-500 animate-pulse`} />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Supabase Realtime Ready
              </span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-600 ml-1 uppercase tracking-wider">Your Name</label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-red-500 focus:ring-0 transition-all outline-none text-gray-700 font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleCreateRoom}
                className="flex flex-col items-center justify-center p-4 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-lg hover:shadow-red-200 group"
              >
                <Plus className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-bold">Create Room</span>
              </button>
              <div className="flex flex-col space-y-2">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Room ID"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-blue-500 focus:ring-0 transition-all outline-none text-gray-700 font-medium text-center uppercase"
                />
                <button
                  onClick={handleJoinRoom}
                  className="flex items-center justify-center py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-lg hover:shadow-blue-200 font-bold"
                >
                  <UserPlus className="w-5 h-5 mr-2" />
                  Join
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-red-50 text-red-600 p-3 rounded-xl flex items-center text-sm font-medium border border-red-100"
              >
                <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  if (gameState.status === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-lg">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h2 className="text-2xl font-black text-gray-800">Lobby</h2>
              <p className="text-gray-500 font-medium">Waiting for players...</p>
            </div>
            <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-widest block">Room ID</span>
              <span className="text-xl font-black text-blue-700 tracking-widest">{gameState.roomId}</span>
            </div>
          </div>

          <div className="space-y-3 mb-8">
            {gameState.players.map((p) => (
              <div key={p.id} className="flex items-center p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center text-white font-bold mr-4">
                  {p.name[0].toUpperCase()}
                </div>
                <span className="font-bold text-gray-700 flex-grow">{p.name} {p.id === myId && '(You)'}</span>
                {p.isReady && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md uppercase">Ready</span>}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 2 - gameState.players.length) }).map((_, i) => (
              <div key={i} className="p-4 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400 font-medium">
                Waiting for player...
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleLeaveRoom}
              className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-bold transition-all flex items-center justify-center"
            >
              <LogOut className="w-5 h-5 mr-2" />
              Leave
            </button>
            <button
              onClick={handleStartGame}
              disabled={gameState.players.length < 2}
              className={`flex-[2] py-4 rounded-xl font-bold transition-all flex items-center justify-center shadow-lg ${
                gameState.players.length >= 2 
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-200' 
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Play className="w-5 h-5 mr-2" />
              Start Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'ended') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center p-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-3xl shadow-2xl p-12 text-center max-w-md w-full"
        >
          <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Trophy className="w-12 h-12 text-yellow-600" />
          </div>
          <h2 className="text-4xl font-black text-gray-800 mb-2">Game Over!</h2>
          <p className="text-xl text-gray-600 mb-8">
            Winner: <span className="font-black text-red-600">{gameState.winner}</span>
          </p>
          <button
            onClick={handleLeaveRoom}
            className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-lg transition-all shadow-xl shadow-red-200"
          >
            Return to Lobby
          </button>
        </motion.div>
      </div>
    );
  }

  const topCard = gameState.discardPile[gameState.discardPile.length - 1];
  const currentColor = gameState.wildColor || topCard.color;

  return (
    <div className="min-h-screen bg-green-800 text-white p-4 flex flex-col overflow-hidden font-sans">
      <div className="flex justify-between items-center mb-4 bg-black/20 p-3 rounded-2xl backdrop-blur-sm">
        <div className="flex items-center">
          <div className="bg-red-600 px-3 py-1 rounded-lg font-black text-sm mr-3 shadow-md">UNO</div>
          <div className="text-xs font-bold text-white/70 uppercase tracking-widest">Room: {gameState.roomId}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm font-bold flex items-center">
            <RefreshCw className={`w-4 h-4 mr-2 ${gameState.direction === 1 ? 'rotate-0' : 'rotate-180'} transition-transform`} />
            {gameState.direction === 1 ? 'Clockwise' : 'Counter-Clockwise'}
          </div>
          <button onClick={handleLeaveRoom} className="p-2 hover:bg-white/10 rounded-lg transition-all">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-grow relative flex flex-col items-center justify-center">
        <div className="absolute top-0 w-full flex justify-center gap-8 p-4">
          {gameState.players.filter(p => p.id !== myId).map((p) => {
            const isHisTurn = gameState.players[gameState.currentPlayerIndex].id === p.id;
            return (
              <motion.div 
                key={p.id}
                ref={el => playerRefs.current[p.id] = el}
                animate={isHisTurn ? { scale: 1.1 } : { scale: 1 }}
                className={`flex flex-col items-center p-3 rounded-2xl transition-all ${isHisTurn ? 'bg-white/20 ring-2 ring-yellow-400' : 'bg-black/10'}`}
              >
                <div className="relative mb-2">
                  <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center font-bold border-2 border-white/20">
                    {p.name[0].toUpperCase()}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-red-600 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm">
                    {p.hand.length}
                  </div>
                </div>
                <span className="text-xs font-bold truncate max-w-[80px]">{p.name}</span>
              </motion.div>
            );
          })}
        </div>

        <div className="flex items-center gap-12">
          <div className="flex flex-col items-center gap-2">
            <div 
              ref={drawPileRef}
              onClick={isMyTurn ? handleDrawCard : undefined}
              className={`cursor-pointer transition-transform hover:scale-105 active:scale-95 ${!isMyTurn ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <UnoCard card={{} as Card} isBack />
            </div>
            <span className="text-xs font-black text-white/50 uppercase tracking-widest">Draw Pile</span>
          </div>

          <div className="relative flex flex-col items-center gap-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={topCard.id}
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                className="relative"
              >
                <UnoCard card={topCard} disabled />
                {gameState.wildColor && (
                  <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full border-2 border-white shadow-md ${
                    gameState.wildColor === 'red' ? 'bg-red-500' :
                    gameState.wildColor === 'blue' ? 'bg-blue-500' :
                    gameState.wildColor === 'green' ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                )}
              </motion.div>
            </AnimatePresence>
            <span className="text-xs font-black text-white/50 uppercase tracking-widest">Discard</span>
          </div>
        </div>

        <div className="mt-8 bg-black/30 px-6 py-2 rounded-full backdrop-blur-md border border-white/10">
          <p className="text-sm font-bold text-yellow-400">{gameState.lastAction}</p>
        </div>
      </div>

      <div className="h-48 flex flex-col items-center justify-end pb-4">
        <div className="mb-4 flex items-center gap-2">
          <span className={`px-6 py-2 rounded-full text-sm font-black uppercase tracking-widest shadow-lg ${isMyTurn ? 'bg-yellow-400 text-black animate-bounce' : 'bg-white/10 text-white/50'}`}>
            {isMyTurn ? "🔥 YOUR TURN 🔥" : "Waiting for others..."}
          </span>
        </div>
        
        <div 
          ref={myHandRef}
          className="flex flex-wrap justify-center gap-2 max-w-full overflow-y-auto max-h-40 px-4 py-2 scrollbar-hide"
        >
          {currentPlayer?.hand.map((card) => {
            const canPlay = isMyTurn && (card.color === 'wild' || card.color === currentColor || card.value === topCard.value);
            return (
              <UnoCard 
                key={card.id} 
                card={card} 
                onClick={() => handlePlayCard(card)}
                disabled={!canPlay}
              />
            );
          })}
        </div>
      </div>

      <div className="fixed inset-0 pointer-events-none z-[100]">
        <AnimatePresence>
          {animatingCards.map((anim) => (
            <motion.div
              key={anim.id}
              initial={{ x: anim.start.x, y: anim.start.y, scale: 1, opacity: 1 }}
              animate={{ x: anim.end.x, y: anim.end.y, scale: 0.8, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute"
            >
              <UnoCard card={{} as Card} isBack />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showWildPicker && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"
            >
              <h3 className="text-2xl font-black text-gray-800 mb-6 uppercase tracking-tight">Choose Color</h3>
              <div className="grid grid-cols-2 gap-4">
                {(['red', 'blue', 'green', 'yellow'] as Color[]).map((color) => (
                  <button
                    key={color}
                    onClick={() => handleWildPick(color)}
                    className={`h-24 rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95 ${
                      color === 'red' ? 'bg-red-500' :
                      color === 'blue' ? 'bg-blue-500' :
                      color === 'green' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                  />
                ))}
              </div>
              <button 
                onClick={() => setShowWildPicker(null)}
                className="mt-6 text-gray-400 font-bold hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
