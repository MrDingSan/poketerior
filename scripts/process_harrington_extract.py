#!/usr/bin/env python3
"""Clean and split the Harrington OCR markdown extract.

The original OCR keeps page-image metadata and repeats page headers. This script
removes the obvious OCR scaffolding, separates theory from problem-hand sections,
and rebuilds the hand sections from each "Blinds:" start so missing OCR labels
such as "Hand 4-1" can be inferred.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


PAGE_MARKER_RE = re.compile(r"^\s*<!--\s*Page\s+\d+\s*-->\s*$")
IMAGE_RE = re.compile(r"^\s*\d+\.\s*jpg\s*\([^)]*\)\s*$", re.IGNORECASE)
HAND_RE = re.compile(r"^\s*Hand\s+(\d+)[-–—](\d+)\s*$", re.IGNORECASE)
BLINDS_RE = re.compile(r"^\s*Blinds:\s*")
PROBLEMS_RE = re.compile(r"^\s*The Problems(?:\s+\d+)?\s*$", re.IGNORECASE)
PART_RE = re.compile(
    r"^\s*Part\s+(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)(?:\s*$|:|\s*[.]{3})",
    re.IGNORECASE,
)
PAGE_HEADER_RE = re.compile(r"^\s*\d+\s+(?:Part\s+|Introduction\b|Table of Contents\b|The Problems\b|[.]{3}\s)")
TRAILING_PAGE_HEADER_RE = re.compile(r"^\s*[A-Za-z][A-Za-z .,'’:-]{2,76}\s+\d{1,3}\s*$")
STANDALONE_PAGE_NO_RE = re.compile(r"^\s*(?:[ivxlcdm]+|\d{1,3})\s*$", re.IGNORECASE)
STACK_LINE_RE = re.compile(r"^\s*(?:YOU|[A-G]\s*)?(?:[@&|qos0 ]*\s*)?\$[\d,]+(?:\s+\$[\d,]+)?\s*$", re.IGNORECASE)
DIAGRAM_LINE_RE = re.compile(r"^\s*(?:YOU|[@&|=a-zA-Z ]{1,12})\s*$")


@dataclass(frozen=True)
class RawLine:
    number: int
    text: str


@dataclass(frozen=True)
class Section:
    part_number: int
    start: int
    end: int


PART_TO_NUMBER = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}

OCR_GARBAGE_TOKENS = {
    "eeenas",
    "siiaas",
    "teee",
    "waa",
    "wer",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--theory-output", required=True, type=Path)
    parser.add_argument("--hands-output", required=True, type=Path)
    return parser.parse_args()


def read_raw(path: Path) -> list[RawLine]:
    return [RawLine(i + 1, line.rstrip("\n")) for i, line in enumerate(path.read_text(encoding="utf-8").splitlines())]


def first_real_intro(lines: list[RawLine]) -> int:
    for i, line in enumerate(lines):
        if line.text.strip() == "Introduction":
            return i
    return 0


def part_number_for(line: str) -> int | None:
    match = PART_RE.match(line)
    if not match:
        return None
    return PART_TO_NUMBER[match.group(1).lower()]


def find_problem_sections(lines: list[RawLine]) -> list[Section]:
    sections: list[Section] = []
    current_part = 0
    start: int | None = None
    start_part = 0

    for i, raw in enumerate(lines):
        text = raw.text.strip()
        part = part_number_for(text)
        if part is not None:
            current_part = part
            if start is not None:
                sections.append(Section(start_part, start, i))
                start = None
        if start is None and text == "The Problems":
            start = i
            start_part = current_part

    if start is not None:
        sections.append(Section(start_part, start, len(lines)))

    return [section for section in sections if section.part_number >= 3]


def is_problem_line(line_index: int, sections: list[Section]) -> bool:
    return any(section.start <= line_index < section.end for section in sections)


def is_obvious_noise(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.lower() in OCR_GARBAGE_TOKENS:
        return True
    if PAGE_MARKER_RE.match(stripped) or IMAGE_RE.match(stripped):
        return True
    if PAGE_HEADER_RE.match(stripped):
        return True
    if TRAILING_PAGE_HEADER_RE.match(stripped):
        return True
    if PROBLEMS_RE.match(stripped):
        return True
    if STANDALONE_PAGE_NO_RE.match(stripped):
        return True
    if stripped != "YOU" and stripped.isalpha() and len(stripped) <= 10:
        uppercase_count = sum(1 for ch in stripped if ch.isupper())
        if uppercase_count >= 2 or len(set(stripped.lower())) <= 2:
            return True
    return False


def clean_lines(raw_lines: list[RawLine]) -> list[str]:
    cleaned: list[str] = []
    blank_pending = False

    for raw in raw_lines:
        text = raw.text.rstrip()
        if is_obvious_noise(text):
            blank_pending = True
            continue

        stripped = text.strip()
        if not stripped:
            blank_pending = True
            continue

        # A few OCR lines are pure decorative separators. Keep card/stack lines.
        if len(stripped) <= 2 and not any(ch.isdigit() or ch == "$" for ch in stripped):
            blank_pending = True
            continue

        if blank_pending and cleaned and cleaned[-1] != "":
            cleaned.append("")
        cleaned.append(stripped)
        blank_pending = False

    while cleaned and cleaned[0] == "":
        cleaned.pop(0)
    while cleaned and cleaned[-1] == "":
        cleaned.pop()
    return cleaned


def write_markdown(path: Path, title: str, body_lines: list[str], source: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = [
        f"# {title}",
        "",
        f"Source: `{source}`",
        "",
        "_Generated by `scripts/process_harrington_extract.py` from OCR markdown._",
        "",
    ]
    path.write_text("\n".join(header + body_lines).rstrip() + "\n", encoding="utf-8")


def theory_lines(lines: list[RawLine], intro_start: int, sections: list[Section]) -> list[str]:
    kept = [raw for i, raw in enumerate(lines[intro_start:]) if not is_problem_line(i + intro_start, sections)]
    return clean_lines(kept)


def hand_start_for_blinds(section_lines: list[RawLine], blinds_index: int) -> int:
    for j in range(blinds_index - 1, max(-1, blinds_index - 10), -1):
        stripped = section_lines[j].text.strip()
        if HAND_RE.match(stripped):
            return j
    start = blinds_index
    for j in range(blinds_index - 1, max(-1, blinds_index - 8), -1):
        stripped = section_lines[j].text.strip()
        if not stripped or PAGE_MARKER_RE.match(stripped) or IMAGE_RE.match(stripped) or PROBLEMS_RE.match(stripped):
            break
        if STACK_LINE_RE.match(stripped) or stripped == "YOU" or DIAGRAM_LINE_RE.match(stripped):
            start = j
            continue
        break
    return start


def hand_chunks(lines: list[RawLine], sections: list[Section]) -> list[tuple[str, list[str], int]]:
    chunks: list[tuple[str, list[str], int]] = []
    for section in sections:
        section_lines = lines[section.start : section.end]
        starts: list[int] = []
        for i, raw in enumerate(section_lines):
            if BLINDS_RE.match(raw.text.strip()):
                starts.append(hand_start_for_blinds(section_lines, i))
        starts = sorted(set(starts))
        starts.append(len(section_lines))

        for sequence, (start, end) in enumerate(zip(starts, starts[1:]), start=1):
            label = f"Hand {section.part_number}-{sequence}"
            raw_chunk = section_lines[start:end]
            cleaned = clean_lines(raw_chunk)
            cleaned = [line for line in cleaned if not HAND_RE.match(line)]
            chunks.append((label, cleaned, raw_chunk[0].number if raw_chunk else 0))
    return chunks


def hands_lines(chunks: list[tuple[str, list[str], int]]) -> list[str]:
    output: list[str] = []
    for label, cleaned, source_line in chunks:
        if output:
            output.append("")
        output.append(f"## {label}")
        output.append("")
        output.append(f"_Original OCR starts near line {source_line}._")
        output.append("")
        output.extend(cleaned)
    return output


def main() -> None:
    args = parse_args()
    raw = read_raw(args.input)
    intro_start = first_real_intro(raw)
    sections = find_problem_sections(raw)
    chunks = hand_chunks(raw, sections)

    write_markdown(args.theory_output, "Harrington Cash Game Theory Extract", theory_lines(raw, intro_start, sections), args.input)
    write_markdown(args.hands_output, "Harrington Cash Game Hand Examples", hands_lines(chunks), args.input)

    print(f"theory_output={args.theory_output}")
    print(f"hands_output={args.hands_output}")
    print(f"problem_sections={len(sections)}")
    print(f"hands={len(chunks)}")
    for section in sections:
        print(f"section_part={section.part_number} raw_lines={raw[section.start].number}-{raw[section.end - 1].number}")


if __name__ == "__main__":
    main()
