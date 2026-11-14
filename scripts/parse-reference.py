"""Extract bounded text from reference documents supplied on stdin."""
import io
import json
import sys
import zipfile
from xml.etree import ElementTree

LIMIT = 6000
sys.stdout.reconfigure(encoding="utf-8")


def read_text(raw):
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError("文本编码无法识别，请保存为 UTF-8 后重试")


def read_pdf(raw):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw), strict=False)
    if reader.is_encrypted:
        raise ValueError("加密 PDF 暂不支持")
    return "\n".join((page.extract_text() or "") for page in reader.pages[:30]), len(reader.pages) > 30


def read_docx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        item = archive.getinfo("word/document.xml")
        if item.file_size > 8 * 1024 * 1024:
            raise ValueError("Word 文档内容过大")
        root = ElementTree.fromstring(archive.read(item))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(ns + "p"):
        line = "".join(node.text or "" for node in paragraph.iter(ns + "t")).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs)


def main():
    extension = sys.argv[1]
    raw = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("单个文档不能超过 5 MB")
    if extension in ("txt", "md"):
        extracted = read_text(raw)
        pages_truncated = False
    elif extension == "pdf":
        extracted, pages_truncated = read_pdf(raw)
    elif extension == "docx":
        extracted = read_docx(raw)
        pages_truncated = False
    else:
        raise ValueError("暂不支持这种文档格式")
    extracted = "\n".join(line.strip() for line in extracted.splitlines() if line.strip())
    if not extracted:
        raise ValueError("未提取到文字；扫描版 PDF 请先转成可复制文字的文档")
    print(json.dumps({"text": extracted[:LIMIT], "truncated": pages_truncated or len(extracted) > LIMIT}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
