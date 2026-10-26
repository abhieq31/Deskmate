// The vendored browser builds ship as plain JavaScript; these are the parts Deskmate uses.

declare module '*/vendor/chess.js' {
  export type Square = string;
  export interface Move {
    color: 'w' | 'b'; from: Square; to: Square; piece: string; san: string; lan: string;
    before: string; after: string; captured?: string; promotion?: string; flags: string;
  }
  export const DEFAULT_POSITION: string;
  export class Chess {
    constructor(fen?: string);
    move(m: string | { from: string; to: string; promotion?: string }): Move;
    moves(): string[];
    moves(opts: { verbose: true; square?: string }): Move[];
    moves(opts: { verbose?: false; square?: string }): string[];
    fen(): string;
    turn(): 'w' | 'b';
    undo(): Move | null;
    history(): string[];
    history(opts: { verbose: true }): Move[];
    isCheckmate(): boolean;
    isStalemate(): boolean;
    isInsufficientMaterial(): boolean;
    isThreefoldRepetition(): boolean;
    isDraw(): boolean;
    isDrawByFiftyMoves(): boolean;
    isGameOver(): boolean;
    inCheck(): boolean;
    isCheck(): boolean;
    board(): ({ square: Square; type: string; color: 'w' | 'b' } | null)[][];
    get(square: Square): { type: string; color: 'w' | 'b' } | undefined;
    loadPgn(pgn: string): void;
    pgn(): string;
    header(...args: string[]): Record<string, string>;
    getHeaders(): Record<string, string>;
    getComments(): { fen: string; comment: string }[];
    setComment(comment: string): void;
  }
}

declare module '*/vendor/secp256k1.js' {
  export const schnorr: {
    getPublicKey(secret: Uint8Array): Uint8Array;
    signAsync(msg: Uint8Array, secret: Uint8Array): Promise<Uint8Array>;
    verifyAsync(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): Promise<boolean>;
  };
}
