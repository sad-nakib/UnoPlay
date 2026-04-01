import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Play, LogOut, Plus, UserPlus, ArrowRight, Trophy, AlertCircle, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Card, Color, GameState, Player, ServerToClientEvents, ClientToServerEvents } from './types';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

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
      case 'wild': return 'bg-gray-800';
      default: return 'bg-gray-400';
    }
  };

  if (isBack) {
    return (
      <div className={`w-20 h-32 bg-red-800 rounded-lg border-4 border-white flex items-center justify-center shadow-lg ${className || ''}`}>
        <div className="w-14 h-24 bg-red-900 rounded-md flex items-center justify-center">
          <span className="text-white font-bold text-xl rotate-45">UNO</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      whileHover={!disabled ? { y: -10, scale: 1.05 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`relative w-20 h-32 ${getColorClass(card.color)} rounded-lg border-4 border-white flex flex-col items-center justify-center shadow-lg cursor-pointer transition-opacity ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${isCurrent ? 'ring-4 ring-yellow-300' : ''} ${className || ''}`}
    >
      <div className="absolute top-1 left-1 text-white font-bold text-xs">{card.value}</div>
      <div className="w-14 h-24 bg-white/20 rounded-full flex items-center justify-center">
        <span className="text-white font-bold text-2xl drop-shadow-md">
          {card.value === 'skip' && '⊘'}
          {card.value === 'reverse' && '⇄'}
          {card.value === 'draw2' && '+2'}
          {card.value === 'wild' && 'W'}
          {card.value === 'wild4' && '+4'}
          {parseInt(card.value) >= 0 && card.value}
        </span>
      </div>
      <div className="absolute bottom-1 right-1 text-white font-bold text-xs rotate-180">{card.value}</div>
    </motion.div>
  );
};

interface AnimatingCard {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export default function App() {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [prevPlayers, setPrevPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWildPicker, setShowWildPicker] = useState<{ cardId: string } | null>(null);
  const [animatingCards, setAnimatingCards] = useState<AnimatingCard[]>([]);
  const [isConnected, setIsConnected] = useState(socket.connected);

  const drawPileRef = useRef<HTMLDivElement>(null);
  const myHandRef = useRef<HTMLDivElement>(null);
  const playerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    socket.on('room_state', (state) => {
      setGameState(prevState => {
        if (prevState) {
          setPrevPlayers(prevState.players);
        }
        return state;
      });
      setError(null);
      if (state.status === 'ended' && state.winner) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    });

    socket.on('error', (msg) => {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state');
      socket.off('error');
    };
  }, []);

  // Detect card draws and trigger animations
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
        if (player.id === socket.id) {
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
      // Clear animations after a delay
      setTimeout(() => {
        setAnimatingCards(prev => prev.filter(c => !newAnimatingCards.find(nc => nc.id === c.id)));
      }, 800);
    }
  }, [gameState, prevPlayers]);

  const handleCreateRoom = () => {
    if (!name) return setError('Please enter your name');
    socket.emit('create_room', name);
  };

  const handleJoinRoom = () => {
    if (!name || !roomId) return setError('Please enter name and room ID');
    socket.emit('join_room', roomId, name);
  };

  const handleStartGame = () => {
    socket.emit('start_game');
  };

  const handlePlayCard = (card: Card) => {
    if (card.color === 'wild') {
      setShowWildPicker({ cardId: card.id });
    } else {
      socket.emit('play_card', card.id);
    }
  };

  const handleWildPick = (color: Color) => {
    if (showWildPicker) {
      socket.emit('play_card', showWildPicker.cardId, color);
      setShowWildPicker(null);
    }
  };

  const handleDrawCard = () => {
    socket.emit('draw_card');
  };

  const handleLeaveRoom = () => {
    socket.emit('leave_room');
    setGameState(null);
    setPrevPlayers([]);
  };

  const currentPlayer = useMemo(() => {
    return gameState?.players.find(p => p.id === socket.id);
  }, [gameState]);

  const isMyTurn = useMemo(() => {
    if (!gameState) return false;
    return gameState.players[gameState.currentPlayerIndex].id === socket.id;
  }, [gameState]);

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
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {isConnected ? 'Server Connected' : 'Server Disconnected'}
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
                <span className="font-bold text-gray-700 flex-grow">{p.name} {p.id === socket.id && '(You)'}</span>
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
      {/* Header */}
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

      {/* Main Game Area */}
      <div className="flex-grow relative flex flex-col items-center justify-center">
        {/* Other Players */}
        <div className="absolute top-0 w-full flex justify-center gap-8 p-4">
          {gameState.players.filter(p => p.id !== socket.id).map((p, idx) => {
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

        {/* Center Table */}
        <div className="flex items-center gap-12">
          {/* Draw Pile */}
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

          {/* Discard Pile */}
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

        {/* Current Action Message */}
        <div className="mt-8 bg-black/30 px-6 py-2 rounded-full backdrop-blur-md border border-white/10">
          <p className="text-sm font-bold text-yellow-400">{gameState.lastAction}</p>
        </div>
      </div>

      {/* My Hand */}
      <div className="h-48 flex flex-col items-center justify-end pb-4">
        <div className="mb-4 flex items-center gap-2">
          <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${isMyTurn ? 'bg-yellow-400 text-black animate-pulse' : 'bg-white/10 text-white/50'}`}>
            {isMyTurn ? "Your Turn!" : "Waiting..."}
          </span>
          {isMyTurn && (
            <span className="text-[10px] font-bold text-white/50 uppercase">Play a {currentColor} card or same value</span>
          )}
        </div>
        
        <div 
          ref={myHandRef}
          className="flex justify-center -space-x-8 hover:space-x-2 transition-all duration-300 max-w-full overflow-x-auto px-12 py-4 scrollbar-hide"
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

      {/* Animating Cards Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50">
        <AnimatePresence>
          {animatingCards.map((anim) => (
            <motion.div
              key={anim.id}
              initial={{ x: anim.start.x, y: anim.start.y, scale: 1, opacity: 1 }}
              animate={{ x: anim.end.x, y: anim.end.y, scale: 0.6, opacity: 0.8 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              className="absolute"
            >
              <UnoCard card={{} as Card} isBack />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Wild Color Picker Modal */}
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
