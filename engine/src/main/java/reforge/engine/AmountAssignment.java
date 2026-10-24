package reforge.engine;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

/** The constraints Forge passes to its assignment UI, shared by validation and the wire prompt. */
final class AmountAssignment {
    final int total;
    final int[] minimums, maximums, lethal;
    final boolean ordered, divideFreely;
    final int defender;

    AmountAssignment(int total, int[] minimums, int[] maximums, int[] lethal,
                     boolean ordered, boolean divideFreely, int defender) {
        this.total = total;
        this.minimums = minimums;
        this.maximums = maximums;
        this.lethal = lethal;
        this.ordered = ordered;
        this.divideFreely = divideFreely;
        this.defender = defender;
    }

    boolean valid(int[] amounts) {
        if (amounts == null || amounts.length != minimums.length) return false;
        long sum = 0;
        boolean earlierHasLethal = true;
        for (int i = 0; i < amounts.length; i++) {
            int n = amounts[i];
            if (n < minimums[i] || n > maximums[i]) return false;
            if (!divideFreely && n > 0 && (ordered || i == defender) && !earlierHasLethal) return false;
            if (lethal != null && i != defender) earlierHasLethal &= n >= lethal[i];
            sum += n;
        }
        return sum == total;
    }

    int[] suggested() {
        int[] result = minimums.clone();
        int left = total;
        for (int n : result) left -= n;
        if (lethal != null && !divideFreely) {
            for (int i = 0; i < result.length && left > 0; i++) {
                if (i == defender) break;
                int n = Math.min(left, Math.max(0, lethal[i] - result[i]));
                result[i] += n;
                left -= n;
            }
            // After lethal, excess may go to the defender (trample) or the last blocker.
            if (left > 0 && result.length > 0) result[result.length - 1] += left;
        } else {
            for (int i = 0; i < result.length && left > 0; i++) {
                int n = Math.min(left, maximums[i] - result[i]);
                result[i] += n;
                left -= n;
            }
        }
        return result;
    }

    void describe(JsonObject prompt) {
        prompt.addProperty("total", total);
        prompt.add("minimums", json(minimums));
        prompt.add("maximums", json(maximums));
        prompt.add("initialAmounts", json(suggested()));
        if (lethal != null) prompt.add("lethal", json(lethal));
        prompt.addProperty("ordered", ordered);
        prompt.addProperty("divideFreely", divideFreely);
        prompt.addProperty("defenderIndex", defender);
    }

    private static JsonArray json(int[] values) {
        JsonArray out = new JsonArray();
        for (int n : values) out.add(n);
        return out;
    }
}
