#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Tuple
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

HEADER_WORDS = {"证型", "证候", "证机概要", "治法", "方药"}
NOISE_PATTERNS = [
    re.compile(r"微信公众号"),
    re.compile(r"医心执考"),
]
PRESCRIPTION_HINTS = ("汤", "散", "饮", "丸", "方", "颗粒", "合")
TREATMENT_HINTS = ("解表", "止咳", "宣肺", "清热", "祛湿", "化痰", "滋阴", "益气", "温", "补", "活血", "通络")
DISEASE_TITLE_RE = re.compile(r"^考点\s*(\d+)[★☆\s]*(.+)$")
PULSE_RE = re.compile(r"(脉[^，。；;]*)")


def clean_text(text: str) -> str:
    text = text.replace("\u3000", "")
    text = text.replace(" ", "")
    text = text.strip()
    return text


def read_docx_text_nodes(docx_path: Path) -> List[str]:
    with zipfile.ZipFile(docx_path) as zf:
        xml_data = zf.read("word/document.xml")
    root = ET.fromstring(xml_data)
    nodes = []
    for node in root.findall(".//w:t", NS):
        text = clean_text(node.text or "")
        if text:
            nodes.append(text)
    return nodes


def is_noise(line: str) -> bool:
    return any(pattern.search(line) for pattern in NOISE_PATTERNS)


def normalize_lines(lines: List[str]) -> List[str]:
    result: List[str] = []
    for line in lines:
        line = clean_text(line)
        if not line:
            continue
        if is_noise(line):
            continue
        result.append(line)
    return result


def extract_disease_name(title_tail: str) -> str:
    # 去掉括号说明
    title = re.sub(r"[（(].*?[）)]", "", title_tail)
    title = title.replace("★", "").strip()
    # 防止标题后面夹杂额外描述
    m = re.match(r"^([一-龥A-Za-z0-9]+)", title)
    return m.group(1) if m else title


def is_short_cn(line: str) -> bool:
    return len(line) <= 8 and re.fullmatch(r"[一-龥A-Za-z0-9]+", line) is not None


def looks_like_prescription(line: str) -> bool:
    return any(hint in line for hint in PRESCRIPTION_HINTS)


def looks_like_treatment(line: str) -> bool:
    return len(line) <= 16 and any(hint in line for hint in TREATMENT_HINTS)


def looks_like_new_disease(line: str) -> bool:
    return DISEASE_TITLE_RE.match(line) is not None


def could_be_new_syndrome(lines: List[str], idx: int) -> bool:
    if idx >= len(lines):
        return False
    token = lines[idx]
    if token in HEADER_WORDS:
        return False
    if not is_short_cn(token):
        return False
    if looks_like_treatment(token) or looks_like_prescription(token):
        return False
    if idx + 1 < len(lines):
        nxt = lines[idx + 1]
        if "，" in nxt or "。" in nxt:
            return True
        if is_short_cn(nxt):
            return True
    return False


def split_prescription(text: str) -> Tuple[str, str | None]:
    text = text.replace("，", "").replace("。", "")
    if "或" in text:
        parts = [part.strip() for part in text.split("或") if part.strip()]
        if len(parts) >= 2:
            return parts[0], parts[1]
    return text.strip(), None


def to_symptom_items(symptoms_text: str) -> List[Dict[str, object]]:
    raw_items = re.split(r"[，,、；;。]", symptoms_text)
    cleaned = [item.strip() for item in raw_items if item.strip()]
    if not cleaned:
        return [{"text": "待补充", "is_key": True}]
    items: List[Dict[str, object]] = []
    for idx, item in enumerate(cleaned):
        items.append({"text": item, "is_key": idx < min(3, len(cleaned))})
    return items


def parse_disease_sections(lines: List[str]) -> List[Tuple[str, List[str]]]:
    sections: List[Tuple[str, List[str]]] = []
    current_name = ""
    current_lines: List[str] = []

    for line in lines:
        m = DISEASE_TITLE_RE.match(line)
        if m:
            if current_name and current_lines:
                sections.append((current_name, current_lines))
            current_name = extract_disease_name(m.group(2))
            current_lines = []
            continue
        if current_name:
            current_lines.append(line)

    if current_name and current_lines:
        sections.append((current_name, current_lines))
    return sections


def parse_syndromes_for_disease(disease_name: str, lines: List[str], warnings: List[str]) -> List[Dict[str, object]]:
    result: List[Dict[str, object]] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        if line in HEADER_WORDS or looks_like_new_disease(line):
            i += 1
            continue
        if line.startswith("考点"):
            i += 1
            continue
        if not could_be_new_syndrome(lines, i):
            i += 1
            continue

        syndrome_name_parts = [lines[i]]
        i += 1
        while i < len(lines) and is_short_cn(lines[i]) and len(syndrome_name_parts) < 3:
            if lines[i] in HEADER_WORDS or looks_like_treatment(lines[i]) or looks_like_prescription(lines[i]):
                break
            syndrome_name_parts.append(lines[i])
            i += 1
            if i < len(lines) and ("，" in lines[i] or "。" in lines[i]):
                break
        syndrome_name = "".join(syndrome_name_parts)

        symptom_parts: List[str] = []
        while i < len(lines):
            token = lines[i]
            if token in HEADER_WORDS:
                i += 1
                continue
            if looks_like_new_disease(token):
                break
            if could_be_new_syndrome(lines, i) and symptom_parts:
                break
            symptom_parts.append(token)
            i += 1
            if "。" in token:
                break

        if not symptom_parts:
            warnings.append(f"{disease_name}-{syndrome_name}: 未识别到证候，已跳过")
            continue
        symptoms_full = "".join(symptom_parts).strip()
        if not symptoms_full:
            symptoms_full = "待补充"

        patho_parts: List[str] = []
        while i < len(lines):
            token = lines[i]
            if token in HEADER_WORDS:
                i += 1
                continue
            if looks_like_treatment(token) and patho_parts:
                break
            if looks_like_new_disease(token) or could_be_new_syndrome(lines, i):
                break
            patho_parts.append(token)
            i += 1
            if "。" in token and len("".join(patho_parts)) >= 6:
                break
        pathogenesis = "".join(patho_parts).strip() or "待补充"

        treatment_parts: List[str] = []
        while i < len(lines):
            token = lines[i]
            if token in HEADER_WORDS:
                i += 1
                continue
            if looks_like_prescription(token):
                break
            if looks_like_new_disease(token) or could_be_new_syndrome(lines, i):
                break
            treatment_parts.append(token)
            i += 1
            if len("".join(treatment_parts)) >= 12:
                break
        treatment = "".join(treatment_parts).strip() or "待补充"

        prescription_parts: List[str] = []
        while i < len(lines):
            token = lines[i]
            if token in HEADER_WORDS:
                i += 1
                continue
            if looks_like_new_disease(token):
                break
            if could_be_new_syndrome(lines, i):
                break
            prescription_parts.append(token)
            i += 1
            if len(prescription_parts) >= 3:
                break
            if looks_like_prescription("".join(prescription_parts)):
                if i < len(lines) and could_be_new_syndrome(lines, i):
                    break
        prescription_text = "".join(prescription_parts).strip() or "待补充方药"
        prescription_primary, prescription_alternative = split_prescription(prescription_text)
        if not prescription_primary:
            prescription_primary = "待补充方药"

        result.append(
            {
                "syndrome_name": syndrome_name,
                "symptoms": {
                    "full_text": symptoms_full,
                    "items": to_symptom_items(symptoms_full),
                },
                "pathogenesis": pathogenesis,
                "treatment_method": treatment,
                "prescription": {
                    "primary": prescription_primary,
                    "alternative": prescription_alternative,
                },
                "key_symptom_analysis": [],
            }
        )

    return result


def build_dataset(sections: List[Tuple[str, List[str]]]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]], List[str]]:
    diseases: List[Dict[str, object]] = []
    syndromes: List[Dict[str, object]] = []
    warnings: List[str] = []

    disease_index = 1
    for disease_name, lines in sections:
        parsed_syndromes = parse_syndromes_for_disease(disease_name, lines, warnings)
        if not parsed_syndromes:
            warnings.append(f"{disease_name}: 未解析出证型，已跳过病种")
            continue

        disease_id = f"D{disease_index:03d}"
        disease_index += 1

        syndrome_ids: List[str] = []
        for idx, syndrome in enumerate(parsed_syndromes, start=1):
            syndrome_id = f"{disease_id}_S{idx:02d}"
            syndrome_ids.append(syndrome_id)

            full_text = syndrome["symptoms"]["full_text"]
            pulse_match = PULSE_RE.search(full_text)
            pulse_text = pulse_match.group(1) if pulse_match else "待补充"
            _ = pulse_text

            syndromes.append(
                {
                    "syndrome_id": syndrome_id,
                    "disease_id": disease_id,
                    "syndrome_name": syndrome["syndrome_name"],
                    "symptoms": syndrome["symptoms"],
                    "pathogenesis": syndrome["pathogenesis"],
                    "treatment_method": syndrome["treatment_method"],
                    "prescription": syndrome["prescription"],
                    "key_symptom_analysis": syndrome["key_symptom_analysis"],
                }
            )

        first_items = parsed_syndromes[0]["symptoms"]["items"]
        key_symptoms = "、".join(item["text"] for item in first_items[:2]) if first_items else "待补充"
        pulse = "待补充"
        pulse_match = PULSE_RE.search(parsed_syndromes[0]["symptoms"]["full_text"])
        if pulse_match:
            pulse = pulse_match.group(1)

        diseases.append(
            {
                "disease_id": disease_id,
                "disease_name": disease_name,
                "key_symptoms": key_symptoms,
                "key_pulse": pulse,
                "category": "内科",
                "related_diseases": [],
                "syndromes": syndrome_ids,
            }
        )

    return diseases, syndromes, warnings


def main() -> int:
    if len(sys.argv) < 3:
        print("用法: python scripts/import_docx.py <docx_path> <output_dir>")
        return 1

    docx_path = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not docx_path.exists():
        print(f"文件不存在: {docx_path}")
        return 1

    lines = normalize_lines(read_docx_text_nodes(docx_path))
    sections = parse_disease_sections(lines)
    diseases, syndromes, warnings = build_dataset(sections)

    diseases_path = output_dir / "diseases.json"
    syndromes_path = output_dir / "syndromes.json"
    report_path = output_dir / "report.json"

    diseases_path.write_text(json.dumps(diseases, ensure_ascii=False, indent=2), encoding="utf-8")
    syndromes_path.write_text(json.dumps(syndromes, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(
        json.dumps(
            {
                "source": str(docx_path),
                "disease_count": len(diseases),
                "syndrome_count": len(syndromes),
                "warnings": warnings,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"导入完成: {docx_path.name}")
    print(f"- 病种: {len(diseases)}")
    print(f"- 证型: {len(syndromes)}")
    print(f"- 输出目录: {output_dir}")
    print(f"- 报告文件: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
