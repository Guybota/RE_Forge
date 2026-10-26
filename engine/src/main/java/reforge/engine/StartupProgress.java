package reforge.engine;

import forge.gui.interfaces.IProgressBar;

/** Forge's real card-reader progress, reserved below the final server/UI startup stages. */
final class StartupProgress implements IProgressBar {
    private int maximum = 1000;
    private int shown = -1;
    synchronized void stage(int percent) {
        int next = Math.max(shown, Math.min(100, Math.max(0, percent)));
        if (next == shown) return;
        shown = next;
        System.out.println("PROGRESS " + shown);
        System.out.flush();
    }
    @Override public void setValue(int value) { stage(5 + (int) (85L * Math.max(0, value) / Math.max(1, maximum))); }
    @Override public void setMaximum(int value) { maximum = Math.max(1, value); }
    @Override public int getMaximum() { return maximum; }
    @Override public void setDescription(String description) { }
    @Override public void reset() { }
    @Override public void setShowETA(boolean value) { }
    @Override public void setShowCount(boolean value) { }
    @Override public void setPercentMode(boolean value) { }
}
