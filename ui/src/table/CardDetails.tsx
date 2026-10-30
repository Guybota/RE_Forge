import type { CardState } from '../engine';
import { isMessageKey, useT } from '../i18n';
import { ManaCost, SymbolText } from '../ManaSymbol';

/** Persistent choices and conditions come from Forge, independently of the printed card. */
export function CardDetails({ card, playerNames }: { card: CardState; playerNames?: Map<number, string> }) {
  const t = useT();
  const rows: [string, string][] = [];
  if (card.chosenType || card.chosenType2) rows.push([t('cardChosenType'), [card.chosenType, card.chosenType2].filter(Boolean).join(', ')]);
  if (card.chosenColors?.length) rows.push([t('cardChosenColors'), card.chosenColors.map((color) => {
    const key = `color_${color.toLowerCase()}`;
    return isMessageKey(key) ? t(key) : color;
  }).join(', ')]);
  if (card.chosenNumber !== undefined) rows.push([t('cardChosenNumber'), card.chosenNumber]);
  if (card.namedCards?.length) rows.push([t('cardNamedCards'), card.namedCards.join(', ')]);
  if (card.chosenPlayerId !== undefined && playerNames?.has(card.chosenPlayerId)) rows.push([t('cardChosenPlayer'), playerNames.get(card.chosenPlayerId)!]);
  if (card.chosenMode) rows.push([t('cardChosenMode'), card.chosenMode]);
  if (card.classLevel !== undefined) rows.push([t('cardClassLevel'), String(card.classLevel)]);
  if (card.currentRoom) rows.push([t('cardCurrentRoom'), card.currentRoom]);
  if (card.ringLevel) rows.push([t('cardRingLevel'), String(card.ringLevel)]);
  const conditions = [
    card.phasedOut && t('cardPhasedOut'), card.exerted && t('cardExerted'), card.detained && t('cardDetained'),
    card.sick && t('cardSummoningSick'), card.ringBearer && t('cardRingBearer'),
    !!card.shieldCount && t('cardRegeneration', { n: card.shieldCount! }),
    !!card.preventNextDamage && t('cardPreventDamage', { n: card.preventNextDamage! }),
  ].filter(Boolean);
  if (!rows.length && !conditions.length && !card.overlayText) return null;
  return <section className="zoom__state" aria-label={t('cardCurrentState')}>
    {conditions.length > 0 && <ul className="zoom__counters">{conditions.map((text) => <li className="chip" key={String(text)}>{text}</li>)}</ul>}
    {rows.length > 0 && <dl className="zoom__choices">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><SymbolText text={value} /></dd></div>)}</dl>}
    {card.overlayText && <p><SymbolText text={card.overlayText} /></p>}
  </section>;
}

/** Keep an explicit empty runtime string: losing all abilities must never restore the printed rules. */
export function CurrentCardText({ card }: { card: CardState }) {
  const t = useT();
  const text = card.gameText ?? card.text;
  return <>
    <h2>{card.name}</h2>
    {card.cost && <p><ManaCost cost={card.cost} /></p>}
    {card.type && <p className="zoom__type">{card.type}</p>}
    {text ? <p className="zoom__text"><SymbolText text={text} /></p>
      : card.gameText === '' && card.text ? <p className="zoom__text">{t('cardNoAbilityText')}</p> : null}
    {card.power !== undefined && <p>{card.power}/{card.toughness}</p>}
  </>;
}
