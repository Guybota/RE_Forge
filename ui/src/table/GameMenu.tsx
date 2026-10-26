import type { Engine } from '../useEngine';
import { useT } from '../i18n';
import { SettingsDialog } from '../settings/SettingsDialog';

export function GameMenu({ engine, onClose, onLeave }: { engine: Engine; onClose: () => void; onLeave: () => void }) {
  const t = useT();
  return <SettingsDialog engine={engine} inGame onClose={onClose} footer={<>
    <button type="button" className="btn btn--ghost" title={t('leaveGameHint')} onClick={() => { onClose(); onLeave(); }}>{t('leaveGame')}</button>
    <button type="button" className="btn btn--ghost game-menu__concede" onClick={() => { onClose(); engine.send({ type: 'action', action: 'concede' }); }}>{t('concede')}</button>
  </>} />;
}
