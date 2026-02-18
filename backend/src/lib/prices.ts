// Updated imports for prices.ts
import { calculatePrice } from './priceCalculator';
import { PriceConfig } from './types';

export function getPrices(config: PriceConfig): number {
    // Function logic here
    return calculatePrice(config);
}