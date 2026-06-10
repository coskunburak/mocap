from __future__ import annotations

from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "reports" / "figures"

INK = "#1F2937"
MUTED = "#526375"
LINE = "#334E68"
BG = "#FFFFFF"

PALETTE = [
    ("#EAF2F8", "#2E5D7D", "#24475F"),
    ("#FFF7E8", "#D18A1E", "#9A6514"),
    ("#EAF7F0", "#2C8B5F", "#1F6746"),
    ("#EEF0FF", "#5056D6", "#383DA8"),
    ("#FDECEC", "#D33C3C", "#9F2D2D"),
    ("#F5F7FA", "#526173", "#3B4654"),
    ("#E8F7F8", "#1B7F8C", "#155D66"),
    ("#F4ECFF", "#7657C7", "#563F92"),
]


def attrs(**values: str | int | float | None) -> str:
    parts = []
    for key, value in values.items():
        if value is None:
            continue
        attr_name = key[:-1] if key.endswith("_") else key.replace("_", "-")
        parts.append(f'{attr_name}="{escape(str(value), quote=True)}"')
    return " ".join(parts)


def text_el(
    x: float,
    y: float,
    content: str,
    class_name: str = "label",
    anchor: str = "middle",
) -> str:
    return f'<text {attrs(x=x, y=y, **{"text_anchor": anchor}, class_=class_name)}>{escape(content)}</text>'


def text_block(
    x: float,
    y: float,
    lines: list[str] | tuple[str, ...],
    class_name: str = "label",
    anchor: str = "middle",
    line_height: float = 23,
) -> str:
    start_y = y - ((len(lines) - 1) * line_height / 2)
    tspans = [
        f'<tspan x="{x}" y="{start_y + index * line_height}">{escape(line)}</tspan>'
        for index, line in enumerate(lines)
    ]
    return f'<text {attrs(**{"text_anchor": anchor}, class_=class_name)}>' + "".join(tspans) + "</text>"


def rect(x: float, y: float, w: float, h: float, fill: str, stroke: str, rx: float = 8, sw: float = 2) -> str:
    return f'<rect {attrs(x=x, y=y, width=w, height=h, rx=rx, fill=fill, stroke=stroke, **{"stroke_width": sw})}/>'


def arrow(x1: float, y1: float, x2: float, y2: float, stroke: str = LINE, width: float = 4, dashed: bool = False) -> str:
    dash = ' stroke-dasharray="8 8"' if dashed else ""
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
        f'stroke="{stroke}" stroke-width="{width}" stroke-linecap="round"{dash} marker-end="url(#arrow)"/>'
    )


def path_arrow(d: str, stroke: str = LINE, width: float = 4, dashed: bool = False) -> str:
    dash = ' stroke-dasharray="8 8"' if dashed else ""
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dash} marker-end="url(#arrow)"/>'


def card(
    x: float,
    y: float,
    w: float,
    h: float,
    title: list[str] | tuple[str, ...],
    subtitle: list[str] | tuple[str, ...] = (),
    palette_index: int = 0,
    number: str | None = None,
    title_class: str = "cardTitle",
) -> str:
    fill, stroke, badge = PALETTE[palette_index % len(PALETTE)]
    body = [rect(x, y, w, h, fill, stroke)]
    if number is not None:
        body.append(f'<circle cx="{x + 31}" cy="{y + 31}" r="18" fill="{badge}"/>')
        body.append(text_el(x + 31, y + 37, number, "badge"))
    title_y = y + (h * 0.45 if subtitle else h * 0.55)
    body.append(text_block(x + w / 2, title_y, list(title), title_class, line_height=23))
    if subtitle:
        body.append(text_block(x + w / 2, y + h * 0.72, list(subtitle), "cardSub", line_height=20))
    return "\n".join(body)


def chip(x: float, y: float, w: float, label: str, palette_index: int) -> str:
    fill, stroke, _ = PALETTE[palette_index % len(PALETTE)]
    return "\n".join(
        [
            rect(x, y, w, 34, fill, stroke, rx=17, sw=1.7),
            text_el(x + w / 2, y + 23, label, "chip"),
        ]
    )


def phone(x: float, y: float, label: str, accent: str = "#2E5D7D") -> str:
    return "\n".join(
        [
            rect(x, y, 84, 142, "#F8FBFE", accent, rx=18, sw=2.3),
            f'<rect x="{x + 27}" y="{y + 10}" width="30" height="5" rx="2.5" fill="{accent}"/>',
            f'<circle cx="{x + 42}" cy="{y + 124}" r="7" fill="none" stroke="{accent}" stroke-width="2"/>',
            text_block(x + 42, y + 74, [label], "miniLabel", line_height=18),
        ]
    )


def actor(x: float, y: float, accent: str = "#2C8B5F") -> str:
    return "\n".join(
        [
            f'<circle cx="{x}" cy="{y}" r="24" fill="#EAF7F0" stroke="{accent}" stroke-width="3"/>',
            f'<line x1="{x}" y1="{y + 24}" x2="{x}" y2="{y + 91}" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>',
            f'<line x1="{x - 45}" y1="{y + 51}" x2="{x + 45}" y2="{y + 51}" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>',
            f'<line x1="{x}" y1="{y + 91}" x2="{x - 35}" y2="{y + 134}" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>',
            f'<line x1="{x}" y1="{y + 91}" x2="{x + 35}" y2="{y + 134}" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>',
            text_el(x, y + 168, "Oyuncu", "miniLabel"),
        ]
    )


def shell(slug: str, width: int, height: int, title: str, body: str, note: str | list[str] | None = None) -> str:
    note_text = " ".join(note) if isinstance(note, list) else (note or "")
    note_svg = ""
    if note:
        note_lines = note if isinstance(note, list) else [note]
        note_svg = text_block(width / 2, height - 38, list(note_lines), "note", line_height=20)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="{slug}-title {slug}-desc">
  <title id="{slug}-title">{escape(title)}</title>
  <desc id="{slug}-desc">{escape(note_text or title)}</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="{LINE}"/>
    </marker>
    <style>
      .title {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 31px; font-weight: 700; fill: {INK}; }}
      .label {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 20px; font-weight: 700; fill: {INK}; }}
      .cardTitle {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 19px; font-weight: 700; fill: {INK}; }}
      .cardSub {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 16px; font-weight: 500; fill: {MUTED}; }}
      .badge {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 16px; font-weight: 700; fill: #FFFFFF; }}
      .miniLabel {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 15px; font-weight: 700; fill: {INK}; }}
      .small {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 14px; font-weight: 600; fill: {MUTED}; }}
      .chip {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 14px; font-weight: 700; fill: {INK}; }}
      .note {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 17px; font-weight: 500; fill: {MUTED}; }}
      .lane {{ font-family: Arial, "Helvetica Neue", sans-serif; font-size: 16px; font-weight: 700; fill: #FFFFFF; }}
    </style>
  </defs>
  <rect x="0" y="0" width="{width}" height="{height}" fill="{BG}"/>
  {text_el(width / 2, 56, title, "title")}
{body}
{note_svg}
</svg>
'''


def fig_1_1() -> str:
    xs = [38, 260, 482, 704, 926, 1148]
    titles = [
        (["Mobil Cihaz"], ["Video + metadata"]),
        (["S3 Depolama"], ["İmzalı upload", "URL"]),
        (["Backend API"], ["Processing job", "+ worker"]),
        (["WHAM / SMPL", "Solve"], ["3B hareket"]),
        (["Cleanup"], ["Temizleme + BVH"]),
        (["Mobil Sonuç", "Ekranı"], ["Kalite raporu", "+ indirme URL"]),
    ]
    body = []
    for index, x in enumerate(xs):
        body.append(card(x, 125, 174, 150, titles[index][0], titles[index][1], index, str(index + 1)))
        if index < len(xs) - 1:
            body.append(arrow(x + 184, 200, xs[index + 1] - 10, 200))
    return shell(
        "sekil-1-1",
        1400,
        400,
        "Mocap Genel İş Akışı",
        "\n".join(body),
        "Mobil cihaz üzerinden yüklenen video ve metadata backend hattında işlenerek son kullanıcıya aktarılır.",
    )


def fig_2_1() -> str:
    body = []
    body.append(text_el(270, 104, "Mobil uygulama", "small"))
    for index, (x, label) in enumerate([(70, "Capture UI"), (260, "Native Camera"), (450, "Local Take Repo")]):
        body.append(card(x, 120, 160, 74, [label], (), index, None, "cardTitle"))
    body.append(arrow(535, 196, 322, 247))
    body.append(card(190, 250, 260, 86, ["Signed Upload", "Manager"], ["metadata + video"], 6, "1"))
    body.append(card(560, 250, 220, 86, ["Backend API"], ["upload + process"], 0, "2"))
    body.append(card(880, 250, 220, 86, ["PostgreSQL"], ["kalıcı kayıtlar"], 2, "3"))
    body.append(arrow(452, 293, 550, 293))
    body.append(arrow(782, 293, 870, 293))
    body.append(card(105, 375, 270, 82, ["S3 / MinIO", "Object Storage"], ["video + artifact"], 1, "4"))
    body.append(card(525, 375, 240, 82, ["Worker Queue"], ["job claim"], 7, "5"))
    body.append(card(905, 375, 260, 82, ["WHAM / SMPL", "Worker"], ["GPU pipeline"], 3, "6"))
    body.append(arrow(320, 338, 245, 365))
    body.append(arrow(670, 338, 645, 365))
    body.append(arrow(525, 416, 385, 416))
    body.append(arrow(775, 416, 895, 416))
    body.append(card(490, 470, 430, 70, ["Export Result UI"], ["BVH, JSON raporlar, overlay preview"], 5, None))
    body.append(arrow(245, 459, 490, 500))
    body.append(arrow(645, 459, 645, 462))
    return shell(
        "sekil-2-1",
        1400,
        580,
        "Sistem Mimarisi Blok Diyagramı",
        "\n".join(body),
        "Mobil katman hafif kalır; kalıcı kayıt, nesne depolama ve model işleme backend tarafında ayrışır.",
    )


def lane(y: float, label: str, items: list[tuple[list[str], list[str]]], palette_start: int) -> str:
    body = [
        rect(46, y + 14, 112, 44, "#334E68", "#334E68", rx=22, sw=0),
        text_el(102, y + 43, label, "lane"),
    ]
    xs = [190, 450, 710, 970]
    for i, (title, sub) in enumerate(items):
        body.append(card(xs[i], y, 210, 72, title, sub, palette_start + i))
        if i < len(items) - 1:
            body.append(arrow(xs[i] + 218, y + 36, xs[i + 1] - 10, y + 36, width=3.5))
    return "\n".join(body)


def fig_2_2() -> str:
    body = []
    body.append(
        lane(
            105,
            "Mobil",
            [
                (["Screens"], ["UI girişleri"]),
                (["Hooks / State"], ["durum yönetimi"]),
                (["Domain Models"], ["Take + metadata"]),
                (["Infra Adapters"], ["API + storage"]),
            ],
            0,
        )
    )
    body.append(
        lane(
            220,
            "Backend",
            [
                (["Routes"], ["HTTP sözleşmesi"]),
                (["Services"], ["iş mantığı"]),
                (["Repositories"], ["veri erişimi"]),
                (["PostgreSQL"], ["kalıcılık"]),
            ],
            1,
        )
    )
    body.append(
        lane(
            335,
            "Worker",
            [
                (["Worker"], ["job consumer"]),
                (["Video Pipeline"], ["normalize"]),
                (["WHAM / SMPL"], ["motion solve"]),
                (["Export Validation"], ["BVH + rapor"]),
            ],
            2,
        )
    )
    return shell(
        "sekil-2-2",
        1400,
        480,
        "Mobil, Backend ve Worker Veri Akışı",
        "\n".join(body),
        "Her katman kendi sorumluluğunda kalır; sözleşme verisi bir sonraki katmana kontrollü aktarılır.",
    )


def fig_2_3() -> str:
    body = []
    xs = [60, 385, 710, 1035]
    items = [
        (["Upload Init"], ["POST /uploads/init", "signed PUT URL"]),
        (["Mobil PUT"], ["metadata.json +", "source video"]),
        (["Complete"], ["size + metadata", "validation"]),
        (["Process Job"], ["worker +", "export files"]),
    ]
    for i, x in enumerate(xs):
        body.append(card(x, 130, 245, 112, items[i][0], items[i][1], i, str(i + 1)))
        if i < len(xs) - 1:
            body.append(arrow(x + 255, 186, xs[i + 1] - 10, 186))
    body.append(card(330, 300, 285, 88, ["S3 Uyumlu", "Depolama"], ["object key üzerinden erişim"], 6, None))
    body.append(card(790, 300, 315, 88, ["Artifact Seti"], ["BVH + JSON raporlar + preview"], 2, None))
    body.append(path_arrow("M 508 244 L 508 290"))
    body.append(path_arrow("M 1035 244 C 1020 275 985 290 948 300"))
    body.append(arrow(625, 344, 780, 344))
    return shell(
        "sekil-2-3",
        1400,
        450,
        "Bulut İşleme ve Artifact Üretim Hattı",
        "\n".join(body),
        "API büyük dosyayı taşımak yerine imzalı URL ve doğrulama sözleşmesini yönetir.",
    )


def fig_3_1() -> str:
    body = []
    xs = [34, 184, 334, 484, 634, 784, 934, 1084, 1234]
    items = [
        (["Proje", "Oluştur"], []),
        (["Çekim", "Modu Seç"], ["solo / dual / pro"]),
        (["Kamera", "Kaydı"], ["video + metadata"]),
        (["Review"], ["önizleme"]),
        (["Upload"], ["signed URL"]),
        (["Processing", "Job"], ["backend"]),
        (["Status"], ["polling"]),
        (["Export", "Sonuç"], ["liste"]),
        (["Çıktılar"], ["BVH | kalite | preview"]),
    ]
    for i, x in enumerate(xs):
        body.append(card(x, 135, 126, 118, items[i][0], items[i][1], i, str(i + 1)))
        if i < len(xs) - 1:
            body.append(arrow(x + 134, 194, xs[i + 1] - 8, 194, width=3.2))
    body.append(path_arrow("M 548 260 C 515 315 405 315 378 260", dashed=True, width=3))
    body.append(text_el(462, 330, "Gerekirse yeniden çekim", "small"))
    return shell(
        "sekil-3-1",
        1400,
        410,
        "Temel Kullanım Senaryosu İş Akışı",
        "\n".join(body),
        "Kullanıcı çekimi tamamladıktan sonra yükleme, işleme ve sonuç inceleme adımlarını tek akışta izler.",
    )


def fig_3_2() -> str:
    body = []
    panels = [(50, "Tek Kamera"), (500, "Dual Kamera"), (950, "Pro 4 Kamera")]
    for index, (x, title) in enumerate(panels):
        fill, stroke, _ = PALETTE[index]
        body.append(rect(x, 112, 400, 330, fill, stroke, rx=10, sw=2))
        body.append(text_el(x + 200, 150, title, "label"))
    body.append(phone(105, 205, "Telefon"))
    body.append(actor(332, 216))
    body.append(arrow(205, 276, 275, 276))
    body.append(text_el(220, 383, "Tek cihaz oyuncuyu kadrajda tutar", "small"))

    body.append(phone(535, 205, "Telefon A", "#2C8B5F"))
    body.append(actor(700, 216, "#2C8B5F"))
    body.append(phone(820, 205, "Telefon B", "#2C8B5F"))
    body.append(arrow(635, 276, 670, 276))
    body.append(arrow(818, 276, 735, 276))
    body.append(text_el(700, 383, "İki açı aynı hareketi kaydeder", "small"))

    body.append(actor(1150, 225, "#7657C7"))
    body.append(phone(1110, 165, "Front", "#7657C7"))
    body.append(phone(1272, 230, "Right", "#7657C7"))
    body.append(phone(1110, 298, "Back", "#7657C7"))
    body.append(phone(988, 230, "Left", "#7657C7"))
    body.append(arrow(1152, 210, 1152, 246, width=3))
    body.append(arrow(1270, 300, 1194, 300, width=3))
    body.append(arrow(1152, 300, 1152, 280, width=3))
    body.append(arrow(1075, 300, 1112, 300, width=3))
    body.append(text_el(1150, 420, "Front / right / back / left kamera rolleri", "small"))
    return shell(
        "sekil-3-2",
        1400,
        500,
        "Tek Kamera ve Çoklu Kamera Deney Düzeneği",
        "\n".join(body),
        "Solo üretim hattı ana yol; dual ve pro kurulumlar çoklu kamera tanısı için altyapı sağlar.",
    )


def fig_3_3() -> str:
    body = []
    xs = [42, 216, 390, 564, 738, 912, 1086]
    states = [
        (["Queued"], ["sırada"]),
        (["Ingesting"], ["kaynak alınır"]),
        (["Extracting", "Frames"], ["normalize"]),
        (["Solving", "Motion"], ["WHAM / SMPL"]),
        (["Cleaning"], ["temizleme"]),
        (["Exporting"], ["BVH + rapor"]),
        (["Succeeded"], ["tamamlandı"]),
    ]
    for i, x in enumerate(xs):
        body.append(card(x, 126, 142, 92, states[i][0], states[i][1], i, str(i + 1)))
        if i < len(xs) - 1:
            body.append(arrow(x + 150, 172, xs[i + 1] - 8, 172, width=3.2))
    body.append(card(1060, 300, 190, 78, ["ExportResult", "Screen"], ["mobil sonuç"], 2, None))
    body.append(arrow(1157, 220, 1157, 292))
    body.append(card(545, 300, 280, 78, ["Failed / Canceled"], ["hata veya iptal"], 4, None))
    body.append(path_arrow("M 640 224 C 635 260 650 282 685 294", dashed=True, width=3))
    body.append(path_arrow("M 985 224 C 960 270 860 295 825 330", dashed=True, width=3))
    return shell(
        "sekil-3-3",
        1400,
        440,
        "Processing Job Durum Akışı",
        "\n".join(body),
        "Job terminal state'e ulaştığında kullanıcı başarı, hata veya iptal sonucunu takip eder.",
    )


def fig_4_1() -> str:
    body = []
    body.append(card(210, 118, 210, 80, ["Projects"], ["proje listesi"], 0, "1"))
    body.append(card(500, 118, 220, 80, ["Take Listesi"], ["seçili proje"], 1, "2"))
    body.append(card(800, 118, 240, 80, ["Capture", "Ekranı"], ["kayıt başlat"], 2, "3"))
    body.append(arrow(430, 158, 490, 158))
    body.append(arrow(730, 158, 790, 158))
    vertical = [
        (800, 230, ["Review", "Ekranı"], ["önizleme + metadata"], 3, "4"),
        (800, 330, ["Upload", "İlerleme"], ["signed URL"], 6, "5"),
        (800, 430, ["Processing", "Status"], ["job state"], 7, "6"),
        (800, 530, ["Export", "Sonuç"], ["BVH + rapor"], 5, "7"),
    ]
    for i, (x, y, title, sub, pi, num) in enumerate(vertical):
        body.append(card(x, y, 240, 78, title, sub, pi, num))
        if i == 0:
            body.append(arrow(920, 202, 920, 222))
        if i < len(vertical) - 1:
            body.append(arrow(920, y + 82, 920, vertical[i + 1][1] - 8))
    body.append(path_arrow("M 800 275 C 710 265 710 185 790 176", dashed=True, width=3))
    body.append(text_el(696, 245, "yeniden çekim", "small"))
    return shell(
        "sekil-4-1",
        1400,
        650,
        "Mobil Uygulama Ekran Akışı ve Navigasyon Yapısı",
        "\n".join(body),
        "Kullanıcı proje bağlamından başlayıp çekim, yükleme, processing ve export sonucuna ilerler.",
    )


def fig_4_2() -> str:
    body = []
    columns = [(180, "Mobil Uygulama", 0), (700, "Backend API", 2), (1170, "S3 / MinIO", 1)]
    for x, label, pi in columns:
        fill, stroke, _ = PALETTE[pi]
        body.append(rect(x - 100, 105, 200, 54, fill, stroke, rx=8, sw=2))
        body.append(text_el(x, 140, label, "label"))
        body.append(f'<line x1="{x}" y1="165" x2="{x}" y2="420" stroke="{stroke}" stroke-width="2" stroke-dasharray="7 8"/>')
    body.append(arrow(280, 205, 600, 205))
    body.append(text_el(440, 192, "POST /uploads/init", "small"))
    body.append(arrow(600, 235, 280, 235))
    body.append(text_el(440, 259, "signed PUT URL'leri", "small"))
    body.append(arrow(280, 300, 1070, 300))
    body.append(text_el(675, 287, "PUT metadata.json -> object key", "small"))
    body.append(arrow(280, 350, 1070, 350))
    body.append(text_el(675, 337, "PUT source_video -> object key", "small"))
    body.append(arrow(280, 405, 600, 405))
    body.append(text_el(440, 392, "POST /uploads/complete", "small"))
    body.append(path_arrow("M 785 405 C 920 405 965 388 1070 368", width=3))
    body.append(text_el(925, 426, "object size doğrulama", "small"))
    return shell(
        "sekil-4-2",
        1400,
        485,
        "Upload Akışı ve Signed URL Yönetimi",
        "\n".join(body),
        "Metadata ve video API üzerinden değil, imzalı PUT URL ile doğrudan nesne depolamaya gider.",
    )


def fig_4_3() -> str:
    body = []
    positions = {
        "queued": (80, 120, 150, 74, ["Queued"], 0),
        "ingesting": (280, 120, 150, 74, ["Ingesting"], 1),
        "extracting": (480, 120, 180, 74, ["Extracting", "Frames"], 2),
        "solving": (720, 120, 180, 74, ["Solving", "Motion"], 3),
        "cleaning": (820, 235, 170, 74, ["Cleaning"], 6),
        "exporting": (480, 350, 170, 74, ["Exporting"], 7),
        "succeeded": (720, 350, 170, 74, ["Succeeded"], 2),
        "result": (960, 350, 210, 74, ["ExportResult"], 5),
        "failed": (710, 450, 200, 58, ["Failed / Canceled"], 4),
    }
    for key, (x, y, w, h, title, pi) in positions.items():
        body.append(card(x, y, w, h, title, (), pi))
    body.append(arrow(238, 157, 270, 157))
    body.append(arrow(438, 157, 470, 157))
    body.append(arrow(668, 157, 710, 157))
    body.append(path_arrow("M 812 197 L 873 228"))
    body.append(path_arrow("M 842 312 C 790 345 705 360 660 382"))
    body.append(arrow(660, 387, 710, 387))
    body.append(arrow(900, 387, 950, 387))
    body.append(path_arrow("M 805 426 L 805 442", dashed=True, width=3))
    return shell(
        "sekil-4-3",
        1400,
        570,
        "Processing Job Durum Akışı ve Ekran Geçişleri",
        "\n".join(body),
        "Başarılı job ExportResult ekranına yönlenir; hata veya iptal terminal durumda ayrı gösterilir.",
    )


def fig_5_1() -> str:
    body = []
    xs = [64, 320, 576, 832, 1088]
    items = [
        (["Yerel Paket"], ["video + metadata"]),
        (["URI", "Sanitizasyonu"], ["localUri temizlenir"]),
        (["Signed", "Upload"], ["geçici erişim"]),
        (["Boyut", "Doğrulama"], ["object size"]),
        (["Raporlar"], ["quality + pipeline"]),
    ]
    for i, x in enumerate(xs):
        body.append(card(x, 125, 208, 130, items[i][0], items[i][1], i, str(i + 1)))
        body.append(f'<path d="M {x + 170} 145 l 19 8 v 29 c 0 24 -15 39 -34 49 c -19 -10 -34 -25 -34 -49 v -29 l 19 -8 c 11 7 29 7 49 0z" fill="none" stroke="{PALETTE[i % len(PALETTE)][2]}" stroke-width="2" opacity="0.18"/>')
        if i < len(xs) - 1:
            body.append(arrow(x + 218, 190, xs[i + 1] - 10, 190))
    body.append(card(455, 305, 490, 70, ["Job Timeline"], ["state değişimleri ve bütünlük kayıtları saklanır"], 6))
    body.append(path_arrow("M 936 260 C 910 285 875 298 830 305", width=3))
    return shell(
        "sekil-5-1",
        1400,
        430,
        "Veri Güvenliği ve Bütünlük Kontrol Akışı",
        "\n".join(body),
        "Kaynak veri yüklenmeden önce temizlenir, yükleme sonrası boyut ve artifact bütünlüğü izlenir.",
    )


def fig_6_1() -> str:
    body = []
    phases = [
        ("Bugün", ["Solo WHAM final", "multi-view diagnostics", "temel kalite raporu"], 0),
        ("Kısa", ["Real-device QA", "auth hardening", "golden fixture seti"], 2),
        ("Orta", ["Calibration clip", "audio/native sync", "model preflight"], 1),
        ("Uzun", ["True multi-view solve", "production deploy", "privacy policy"], 3),
    ]
    xs = [50, 380, 710, 1040]
    for i, (label, bullets, pi) in enumerate(phases):
        body.append(card(xs[i], 130, 300, 230, [label], bullets, pi, str(i + 1)))
        if i < len(phases) - 1:
            body.append(arrow(xs[i] + 310, 245, xs[i + 1] - 10, 245))
    body.append(text_el(700, 402, "Test sonuçları bugünkü çalışan hattı gösterir; sonraki fazlar üretim olgunluğunu artırır.", "note"))
    return shell(
        "sekil-6-1",
        1400,
        470,
        "Test Sonuçları ve Gelecek Geliştirme Fazları",
        "\n".join(body),
    )


def fig_8_1() -> str:
    body = []
    steps = [
        (105, ["Değişiklik Talebi"], ["problem, gerekçe, kabul kriteri"], 0, "1"),
        (220, ["Etki Analizi"], ["mobil, API, DB, worker ve artifact etkisi"], 1, "2"),
        (335, ["Uygulama + Test"], ["fixture karşılaştırma ve regresyon kontrolü"], 2, "3"),
        (450, ["Review + Release"], ["release notu ve rollback planı"], 3, "4"),
    ]
    for i, (y, title, sub, pi, num) in enumerate(steps):
        body.append(card(330, y, 740, 82, title, sub, pi, num))
        if i < len(steps) - 1:
            body.append(arrow(700, y + 88, 700, steps[i + 1][0] - 8))
    chip_x = 435
    for i, label in enumerate(["Mobil", "API", "DB", "Worker", "Artifact"]):
        body.append(chip(chip_x + i * 108, 285, 88, label, i))
    return shell(
        "sekil-8-1",
        1400,
        590,
        "Değişiklik Yönetimi Akışı",
        "\n".join(body),
        "Her değişiklik katman etkisiyle birlikte test edilir ve geri dönüş planı olmadan release edilmez.",
    )


def fig_8_2() -> str:
    body = []
    xs = [55, 315, 575, 835, 1095]
    steps = [
        (["Preflight"], ["runtime kontrol"]),
        (["Typecheck"], ["tip güvenliği"]),
        (["Backend QA"], ["endpoint + DB"]),
        (["Worker", "Fixture"], ["pipeline testi"]),
        (["Real Device", "Smoke"], ["cihaz kanıtı"]),
    ]
    for i, x in enumerate(xs):
        body.append(card(x, 135, 210, 92, steps[i][0], steps[i][1], i, str(i + 1)))
        if i < len(xs) - 1:
            body.append(arrow(x + 218, 181, xs[i + 1] - 10, 181, width=3.2))
    body.append(card(505, 305, 390, 80, ["Release Gate"], ["tüm kalite kapıları geçer"], 6, None))
    body.append(path_arrow("M 700 232 L 700 297"))
    body.append(card(505, 430, 390, 80, ["Version Note", "+ Rollback Plan"], ["yayınlama ve geri dönüş kaydı"], 5, None))
    body.append(arrow(700, 390, 700, 422))
    return shell(
        "sekil-8-2",
        1400,
        570,
        "Release Kapısı ve Kalite Güvence Zinciri",
        "\n".join(body),
        "Release kararı otomatik ve manuel kalite kanıtları tamamlandıktan sonra verilir.",
    )


def fig_9_1() -> str:
    body = []
    rows = [
        ("MVP", 115, ["Solo Capture", "WHAM Solve", "BVH Export"], 0),
        ("Growth", 250, ["Pro Presets", "Batch Jobs", "Unity / Unreal / Blender"], 1),
        ("Scale", 385, ["True Multi-view", "Team Workspace", "API / Enterprise Controls"], 2),
    ]
    for row_index, (label, y, titles, pi) in enumerate(rows):
        fill, stroke, _ = PALETTE[pi]
        body.append(rect(55, y + 24, 145, 48, fill, stroke, rx=24, sw=2))
        body.append(text_el(127, y + 55, label, "label"))
        xs = [275, 600, 925]
        widths = [230, 230, 315]
        for i, x in enumerate(xs):
            text_lines = [titles[i]]
            if titles[i] == "Unity / Unreal / Blender":
                text_lines = ["Unity / Unreal", "/ Blender Guides"]
            if titles[i] == "API / Enterprise Controls":
                text_lines = ["API / Enterprise", "Controls"]
            body.append(card(x, y, widths[i], 96, text_lines, (), pi + i, str(i + 1)))
            if i < len(xs) - 1:
                body.append(arrow(x + widths[i] + 10, y + 48, xs[i + 1] - 10, y + 48, width=3.2))
        if row_index < len(rows) - 1:
            body.append(path_arrow(f"M 127 {y + 80} L 127 {rows[row_index + 1][1] + 14}", width=3))
    return shell(
        "sekil-9-1",
        1400,
        535,
        "Ticarileşme Yol Haritası",
        "\n".join(body),
        "MVP tek kamera üretim değerini sunar; büyüme ve ölçek fazları çoklu kamera ve kurumsal yetenekleri ekler.",
    )


FIGURES = {
    "sekil-1-1-mocap-genel-is-akisi.svg": fig_1_1,
    "sekil-2-1-sistem-mimarisi-blok-diyagrami.svg": fig_2_1,
    "sekil-2-2-mobil-backend-worker-veri-akisi.svg": fig_2_2,
    "sekil-2-3-bulut-isleme-artifact-uretim-hatti.svg": fig_2_3,
    "sekil-3-1-temel-kullanim-senaryosu-is-akisi.svg": fig_3_1,
    "sekil-3-2-tek-kamera-coklu-kamera-deney-duzenegi.svg": fig_3_2,
    "sekil-3-3-processing-job-durum-akisi.svg": fig_3_3,
    "sekil-4-1-mobil-uygulama-ekran-akisi.svg": fig_4_1,
    "sekil-4-2-upload-akisi-signed-url-yonetimi.svg": fig_4_2,
    "sekil-4-3-processing-job-durum-akisi-ekran-gecisleri.svg": fig_4_3,
    "sekil-5-1-veri-guvenligi-butunluk-kontrol-akisi.svg": fig_5_1,
    "sekil-6-1-test-sonuclari-gelecek-gelistirme-fazlari.svg": fig_6_1,
    "sekil-8-1-degisiklik-yonetimi-akisi.svg": fig_8_1,
    "sekil-8-2-release-kapisi-kalite-guvence-zinciri.svg": fig_8_2,
    "sekil-9-1-ticarilesme-yol-haritasi.svg": fig_9_1,
}


def write_readme(files: list[str]) -> None:
    lines = [
        "# Mocap rapor şekilleri",
        "",
        "Bu klasörde bitirme raporundaki metin kutusu şekillerinin SVG karşılıkları bulunur.",
        "Dosyalar `tools/generate_report_svgs.py` ile tekrar üretilebilir.",
        "",
    ]
    lines.extend(f"- `{name}`" for name in files)
    (OUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for filename, factory in FIGURES.items():
        (OUT_DIR / filename).write_text(factory(), encoding="utf-8")
        written.append(filename)
    write_readme(written)
    print(f"{len(written)} SVG file generated in {OUT_DIR}")


if __name__ == "__main__":
    main()
