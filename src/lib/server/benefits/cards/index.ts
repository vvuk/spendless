import type { CardDef } from '../types';
import { chaseSapphireReserve } from './chase-sapphire-reserve';
import { amexPlatinum } from './amex-platinum';

/** Every card the engine knows about. Add a card: write its definition, list it here. */
export const CARDS: CardDef[] = [chaseSapphireReserve, amexPlatinum];

export const cardById = (id: string) => CARDS.find((c) => c.id === id);
