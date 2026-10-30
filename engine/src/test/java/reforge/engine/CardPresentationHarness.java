package reforge.engine;

import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.util.List;

import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CounterEnumType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.interfaces.IGameController;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.util.CardTranslation;

/** Real Forge views: current abilities, persistent decisions and hidden-card boundaries. */
public final class CardPresentationHarness {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        try {
            Main.main(args);
            run();
            System.out.println("OK: card presentation, runtime abilities, choices, player counters and hidden identities");
            System.exit(0);
        } catch (Throwable error) {
            error.printStackTrace();
            System.exit(1);
        }
    }

    private static Card card(String name, Player owner, ZoneType zone) {
        Card card = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard(name), owner);
        owner.getZone(zone).add(card);
        return card;
    }

    private static void run() throws Exception {
        GameRules rules = new GameRules(GameType.Constructed);
        List<RegisteredPlayer> players = List.of(
                new RegisteredPlayer(new Deck("One")).setPlayer(GamePlayerUtil.createAiPlayer("One", 0)),
                new RegisteredPlayer(new Deck("Two")).setPlayer(GamePlayerUtil.createAiPlayer("Two", 1)));
        Game game = new Match(rules, players, "Presentation").createGame();
        game.setAge(GameStage.Play);
        Player own = game.getPlayers().get(0), other = game.getPlayers().get(1);
        WebGuiGame gui = new WebGuiGame(new Session(null), new Settings(Files.createTempDirectory("reforge-presentation-settings-").toFile()));
        // Only the viewer/controller identity is needed. No game is played and no input is sent.
        IGameController controller = (IGameController) Proxy.newProxyInstance(IGameController.class.getClassLoader(),
                new Class<?>[] { IGameController.class }, (proxy, method, arguments) -> method.getReturnType() == boolean.class ? false : null);
        gui.setGameController(own.getView(), controller);
        gui.setCurrentPlayer(own.getView());

        Card codie = card("Codie, Vociferous Codex", own, ZoneType.Battlefield);
        JsonObject normal = GameSnapshot.describeCard(codie.getView(), gui);
        check(normal.has("gameText") && !normal.get("gameText").getAsString().isEmpty(), "Codie has current ability text");
        if (CardTranslation.getLanguageSelected().equals("pt-BR")) check(normal.get("gameText").getAsString().contains("Você não pode conjurar mágicas de permanente."),
                "the runtime ability text retains Forge's Portuguese translation");
        check(!normal.get("gameText").getAsString().contains("<span"), "Forge formatting is plain text in React");
        check(!normal.get("text").getAsString().isEmpty(), "printed translated Oracle remains available separately");
        Card secret = card("One with Nothing", other, ZoneType.Hand);
        codie.addRemembered(secret);
        check(!GameSnapshot.describeCard(codie.getView(), gui).get("gameText").getAsString().contains(secret.getName()),
                "runtime text must not append remembered hidden identities");

        // Humility's native continuous effect removes all Codie's abilities and sets its P/T.
        Card humility = card("Humility", own, ZoneType.Battlefield);
        game.getAction().checkStaticAbilities();
        JsonObject suppressed = GameSnapshot.describeCard(codie.getView(), gui);
        check(suppressed.get("power").getAsInt() == 1 && suppressed.get("toughness").getAsInt() == 1, "Humility really applies");
        check(suppressed.get("gameText").getAsString().isEmpty(), "removed abilities must not fall back to the printed Oracle");
        own.getZone(ZoneType.Battlefield).remove(humility);
        game.getAction().checkStaticAbilities();
        check(!GameSnapshot.describeCard(codie.getView(), gui).get("gameText").getAsString().isEmpty(), "abilities return when Humility leaves");

        Card needle = card("Pithing Needle", own, ZoneType.Battlefield);
        needle.setNamedCards(List.of("Codie, Vociferous Codex"));
        check(GameSnapshot.describeCard(needle.getView(), gui).getAsJsonArray("namedCards").get(0).getAsString().equals(codie.getName()), "named card survives the bridge");
        Card cavern = card("Cavern of Souls", own, ZoneType.Battlefield);
        cavern.setChosenType("Wizard");
        check(GameSnapshot.describeCard(cavern.getView(), gui).get("chosenType").getAsString().equals("Wizard"), "chosen creature type survives the bridge");
        Card sun = card("Caged Sun", own, ZoneType.Battlefield);
        sun.setChosenColors(List.of("Blue"));
        check(GameSnapshot.describeCard(sun.getView(), gui).getAsJsonArray("chosenColors").get(0).getAsString().equals("Blue"), "chosen colour survives the bridge");
        sun.setChosenNumber(7, true);
        check(!GameSnapshot.describeCard(sun.getView(), gui).has("chosenNumber"), "a secret number is not exposed");
        sun.setChosenNumber(3);
        check(GameSnapshot.describeCard(sun.getView(), gui).get("chosenNumber").getAsString().equals("3"), "a public number survives the bridge");
        sun.setChosenPlayer(other);
        check(GameSnapshot.describeCard(sun.getView(), gui).get("chosenPlayerId").getAsInt() == other.getId(), "chosen player uses the player id space");
        Card level = card("Wizard Class", own, ZoneType.Battlefield);
        level.setClassLevel(2);
        check(GameSnapshot.describeCard(level.getView(), gui).get("classLevel").getAsInt() == 2, "Class level survives the bridge");
        codie.setPhasedOut(own);
        check(GameSnapshot.describeCard(codie.getView(), gui).get("phasedOut").getAsBoolean(), "phased-out permanent is marked");

        Card morph = card("Willbender", other, ZoneType.Battlefield);
        morph.setNamedCards(List.of(secret.getName()));
        morph.turnFaceDown(true);
        morph.setTapped(true);
        morph.setDamage(1);
        gui.setWeaklySelectable(List.of(morph.getView()));
        JsonObject faceDown = GameSnapshot.describeCard(morph.getView(), gui);
        check(faceDown.get("faceDown").getAsBoolean() && faceDown.get("power").getAsInt() == 2, "face-down creature keeps public characteristics");
        check(faceDown.get("tapped").getAsBoolean() && faceDown.get("damage").getAsInt() == 1 && faceDown.get("actionable").getAsBoolean(), "face-down combat and input state survives");
        check(!faceDown.toString().contains("Willbender") && !faceDown.has("namedCards"), "face-down identity and old choices stay private");
        JsonObject hidden = GameSnapshot.describeCard(secret.getView(), gui);
        check(hidden.size() == 2 && hidden.get("hidden").getAsBoolean(), "unknown hand still has only id and hidden");
        JsonObject revealed = GameSnapshot.describeCard(secret.getView(), gui, true);
        check(revealed.get("name").getAsString().equals(GameSnapshot.name(secret.getView().getCurrentState())), "an explicit reveal grants only the listed identity");
        check(GameSnapshot.describeCard(secret.getView(), gui).size() == 2, "describing a reveal does not persist hidden-zone permission");

        own.setCounters(CounterEnumType.ENERGY, 4, own, false);
        own.setCounters(CounterEnumType.EXPERIENCE, 2, own, false);
        card("Leyline of Sanctity", own, ZoneType.Battlefield);
        game.getAction().checkStaticAbilities();
        JsonObject snapshot = new GameSnapshot(game.getView(), gui, GameSnapshot.Prompt.NONE).json;
        JsonObject statePlayer = snapshot.getAsJsonArray("players").get(0).getAsJsonObject();
        check(statePlayer.getAsJsonObject("counters").get("Energy").getAsInt() == 4
                && statePlayer.getAsJsonObject("counters").get("Experience").getAsInt() == 2, "non-poison player counters survive the bridge");
        check(statePlayer.getAsJsonArray("keywords").asList().stream().anyMatch(k -> k.getAsJsonObject().get("id").getAsString().equals("HEXPROOF")),
                "Leyline of Sanctity's player hexproof survives the bridge");
    }
}
