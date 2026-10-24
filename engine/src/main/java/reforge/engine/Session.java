package reforge.engine;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

import org.java_websocket.WebSocket;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * One connected UI. Fire-and-forget messages go out with {@link #send}; questions that the game
 * thread must wait on go out with {@link #ask}, which blocks until the UI answers or disconnects.
 */
final class Session {
    private static final Gson GSON = new Gson();

    private final WebSocket socket;
    private final AtomicInteger nextQuestionId = new AtomicInteger(1);
    private final Map<Integer, CompletableFuture<JsonObject>> pending = new ConcurrentHashMap<>();
    private volatile boolean closed;

    Session(WebSocket socket) {
        this.socket = socket;
    }

    void send(JsonObject message) {
        if (!closed && socket.isOpen()) {
            socket.send(GSON.toJson(message));
        }
    }

    /** Sends a question with a fresh "id" and waits for the answer. Returns null if the UI went away. */
    JsonObject ask(JsonObject question) {
        if (closed) return null;
        int id = nextQuestionId.getAndIncrement();
        CompletableFuture<JsonObject> answer = new CompletableFuture<>();
        pending.put(id, answer);
        if (closed) answer.complete(null);
        question.addProperty("id", id);
        send(question);
        try {
            return answer.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (ExecutionException e) {
            return null;
        } finally {
            pending.remove(id);
        }
    }

    void onAnswer(JsonObject answer) {
        if (!answer.has("id")) return;
        CompletableFuture<JsonObject> f = pending.get(answer.get("id").getAsInt());
        if (f != null) f.complete(answer);
    }

    /** Unblocks every waiting question with "no answer" so the game thread can't hang forever. */
    void close() {
        closed = true;
        cancelQuestions();
    }

    void cancelQuestions() {
        pending.values().forEach(f -> f.complete(null));
    }

    boolean isClosed() {
        return closed;
    }
}
