package reforge.engine;

import java.util.List;

import forge.game.card.CardView;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
import forge.game.spellability.StackItemView;
import forge.gamemodes.match.DrawOfferMessage;
import forge.gamemodes.match.NextGameDecision;
import forge.gamemodes.match.YieldController;
import forge.gamemodes.match.YieldUpdate;
import forge.interfaces.IDevModeCheats;
import forge.interfaces.IMacroSystem;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.player.AutoYieldStore.TriggerDecision;
import forge.player.PlayerControllerHuman;
import forge.util.ITriggerEvent;

/**
 * Wire-facing controller for a remote human. The real controller still runs every rule and input.
 * Forge dispatches separate protocol calls on separate threads, so releasing a conceding player's
 * pending input must happen inside the same call, after concession finishes, not as another RPC.
 */
final class OnlineController extends PlayerControllerHuman {
    private final PlayerControllerHuman original;

    OnlineController(PlayerControllerHuman original) {
        // Share the real input queue/proxy and GUI. Server reconnect/AFK paths still see a human controller.
        super(original.getPlayer(), original.getPlayer().getLobbyPlayer(), original);
        this.original = original;
    }

    @Override public void concede() {
        original.concede();
        if (original.getPlayer().getOutcome() != null) original.getInputQueue().onGameOver(true);
    }

    @Override public boolean mayLookAtAllCards() { return original.mayLookAtAllCards(); }
    @Override public boolean canPlayUnlimitedLands() { return original.canPlayUnlimitedLands(); }
    @Override public void drawOfferAction(DrawOfferMessage.Action action) { original.drawOfferAction(action); }
    @Override public void alphaStrike() { original.alphaStrike(); }
    @Override public void useMana(byte color) { original.useMana(color); }
    @Override public void selectButtonOk() { original.selectButtonOk(); }
    @Override public void selectButtonCancel() { original.selectButtonCancel(); }
    @Override public void selectPlayer(PlayerView player, ITriggerEvent event) { original.selectPlayer(player, event); }
    @Override public boolean selectCard(CardView card, List<CardView> others, ITriggerEvent event) { return original.selectCard(card, others, event); }
    @Override public void selectAbility(SpellAbilityView ability) { original.selectAbility(ability); }
    @Override public void selectStackItem(StackItemView item) { original.selectStackItem(item); }
    @Override public void undoLastAction() { original.undoLastAction(); }
    @Override public IDevModeCheats cheat() { return original.cheat(); }
    @Override public IMacroSystem macros() { return original.macros(); }
    @Override public void nextGameDecision(NextGameDecision decision) { original.nextGameDecision(decision); }
    @Override public String getActivateDescription(CardView card) { return original.getActivateDescription(card); }
    @Override public void reorderHand(CardView card, int index) { original.reorderHand(card, index); }
    @Override public void requestResync() { original.requestResync(); }
    @Override public void setShouldAutoYield(String key, boolean autoYield, boolean abilityScope) { original.setShouldAutoYield(key, autoYield, abilityScope); }
    @Override public void setDisableAutoYields(boolean disable) { original.setDisableAutoYields(disable); }
    @Override public void setTriggerDecision(String key, TriggerDecision decision, boolean abilityScope) { original.setTriggerDecision(key, decision, abilityScope); }
    @Override public void setDisableAutoTriggers(boolean disable) { original.setDisableAutoTriggers(disable); }
    @Override public void applyYieldUpdate(YieldUpdate update) { original.applyYieldUpdate(update); }
    @Override public YieldController getYieldController() { return original.getYieldController(); }
    @Override public void setYieldPref(FPref pref, String value) { original.setYieldPref(pref, value); }
}
