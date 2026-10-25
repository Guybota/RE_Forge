# Rebuild the Windows icon without a graphics-tool dependency.
Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $PSScriptRoot '../desktop/icon.ico'
$sizes = @(16, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 256.0, $size / 256.0)
    $felt = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#1f3b2d'))
    $paper = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#efe7d6'))
    $border = [System.Drawing.Pen]::new($paper, 9)
    $frame = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $frame.AddArc(8, 8, 48, 48, 180, 90)
    $frame.AddArc(200, 8, 48, 48, 270, 90)
    $frame.AddArc(200, 200, 48, 48, 0, 90)
    $frame.AddArc(8, 200, 48, 48, 90, 90)
    $frame.CloseFigure()
    $graphics.FillPath($felt, $frame)
    $graphics.DrawRectangle($border, 47, 32, 162, 192)
    # Anvil silhouette inside a card frame.
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(67, 83), [System.Drawing.PointF]::new(190, 83),
        [System.Drawing.PointF]::new(173, 111), [System.Drawing.PointF]::new(144, 119),
        [System.Drawing.PointF]::new(144, 151), [System.Drawing.PointF]::new(174, 170),
        [System.Drawing.PointF]::new(174, 185), [System.Drawing.PointF]::new(81, 185),
        [System.Drawing.PointF]::new(81, 170), [System.Drawing.PointF]::new(111, 151),
        [System.Drawing.PointF]::new(111, 119), [System.Drawing.PointF]::new(83, 110)
    )
    $graphics.FillPolygon($paper, $points)
    $stream = [System.IO.MemoryStream]::new()
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    ,$stream.ToArray()
    $stream.Dispose()
    $frame.Dispose()
    $border.Dispose()
    $paper.Dispose()
    $felt.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
$output = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($output)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Length)
    $offset = 6 + 16 * $sizes.Length
    for ($i = 0; $i -lt $sizes.Length; $i++) {
        $dimension = $sizes[$i] % 256
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$i].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$i].Length
    }
    foreach ($png in $images) { $writer.Write([byte[]]$png) }
} finally {
    $writer.Dispose()
}
Write-Output "Icon written to $iconPath"
