export type Color = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
export type Value = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: string;
  color: Color;
  value: Value;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isReady: boolean;
}

export interface GameState {
  roomId: string;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;
  direction: 1 | -1;
  status: 'lobby' | 'playing' | 'ended';
  winner: string | null;
  lastAction: string | null;
  currentEffect: 'none' | 'draw2' | 'draw4' | 'skip';
  wildColor: Color | null;
}

export interface ServerToClientEvents {
  room_state: (state: GameState) => void;
  error: (message: string) => void;
  game_started: (state: GameState) => void;
  card_played: (playerId: string, card: Card) => void;
  card_drawn: (playerId: string) => void;
  turn_changed: (nextPlayerId: string) => void;
  game_over: (winnerId: string) => void;
}

export interface ClientToServerEvents {
  join_room: (roomId: string, name: string) => void;
  create_room: (name: string) => void;
  start_game: () => void;
  play_card: (cardId: string, wildColor?: Color) => void;
  draw_card: () => void;
  leave_room: () => void;
}
