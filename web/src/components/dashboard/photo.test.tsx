import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Thumb } from "./photo";

/**
 * The thumbnail slot is a fixed square whether or not there is a picture.
 *
 * This is the invariant that broke: an empty slot used to render nothing, so
 * rows with a photo were tall and rows without were short, and a list of both
 * was harder to read than a list of neither.
 */
describe("Thumb", () => {
  const box = (html: string) => {
    const m = html.match(/width:\s*(\d+)px;\s*height:\s*(\d+)px/);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  };

  it("takes up the same square with and without a picture", () => {
    const withPhoto = renderToStaticMarkup(
      <Thumb src="/api/items/abc/photo" alt="" size={56} />,
    );
    const without = renderToStaticMarkup(<Thumb src={null} alt="" size={56} />);

    expect(box(withPhoto)).toEqual({ w: 56, h: 56 });
    expect(box(without)).toEqual({ w: 56, h: 56 });
  });

  it("draws nothing in an empty slot — space, not a placeholder", () => {
    const html = renderToStaticMarkup(<Thumb src={null} alt="" size={56} />);
    expect(html).not.toContain("<img");
    // No background or border, or it would read as a broken picture.
    expect(html).not.toContain("bg-muted");
  });

  it("shows the picture when there is one", () => {
    const html = renderToStaticMarkup(<Thumb src="https://example.com/x.jpg" alt="Drill" />);
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/x.jpg"');
    expect(html).toContain('alt="Drill"');
    // contain, not cover: cropping removes what distinguishes the thing.
    expect(html).toContain("object-contain");
  });

  it("defaults to a 64px square", () => {
    expect(box(renderToStaticMarkup(<Thumb src={null} alt="" />))).toEqual({ w: 64, h: 64 });
  });
});
