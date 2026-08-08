/**
 * LES MODÈLES DE CONSOLE.
 *
 * Le modèle est celui de la CONSOLE, pas celui de la cartouche. Une cartouche
 * marquée « compatible CGB » (0x143 bit 7) glissée dans une DMG tourne en DMG :
 * c'est le boîtier qui décide, la cartouche dit seulement ce qu'elle sait faire.
 * D'où trois valeurs et non deux — `AUTO` est la seule qui consulte l'en-tête.
 *
 * Ce n'est pas une subtilité de vocabulaire : onze des ROMs blargg présentes
 * dans les fixtures portent 0x80, et les faire démarrer en CGB parce qu'elles
 * « supportent » le CGB changerait leurs registres au démarrage.
 */
export const DMG = 'dmg';
export const CGB = 'cgb';

/** Suivre la cartouche : CGB si elle le supporte, DMG sinon. */
export const AUTO = 'auto';

export const MODELS = [DMG, CGB];
export const PREFERENCES = [DMG, CGB, AUTO];

export const isModel = (value) => MODELS.includes(value);
export const isPreference = (value) => PREFERENCES.includes(value);
