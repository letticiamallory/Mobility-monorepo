from PIL import Image
import numpy as np


def remove_white_background(input_path, output_path, threshold=240):
    img = Image.open(input_path).convert("RGBA")
    data = np.array(img)

    r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]
    white_mask = (r > threshold) & (g > threshold) & (b > threshold)
    data[:, :, 3] = np.where(white_mask, 0, a)

    result = Image.fromarray(data)
    result.save(output_path, "PNG")
    print(f"Salvo em: {output_path}")


remove_white_background(
    "assets/images/guideddog.jpg",
    "assets/images/guideddog_transparent.png"
)
