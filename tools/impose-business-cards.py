from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject
src = PdfReader("admin/render/business-card.pdf")
W,H = 612.0,792.0; cw,ch = 252.0,144.0; cols,rows = 2,5
mx = (W-cols*cw)/2; my = (H-rows*ch)/2
out = PdfWriter()
for face in src.pages:
    page = out.add_blank_page(width=W,height=H)
    for r in range(rows):
        for c in range(cols):
            x = mx + c*cw; y = H - my - (r+1)*ch
            page.merge_transformed_page(face, Transformation().translate(x,y))
out.add_metadata({"/Title":"Bandera Wagon Wheel RV Park — business cards, 10-up Letter (Avery 5371 layout)"})
out.write("admin/render/business-card-sheet.pdf")
print("margins pt", mx, my)
