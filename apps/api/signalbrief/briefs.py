LABELS = {
    "revenue": "매출",
    "operating_income": "영업이익",
    "guidance": "가이던스",
    "capex": "설비투자",
    "dividend": "배당",
    "management_change": "경영진",
    "risk_change": "위험 문구",
}
INTERPRETATIONS = {
    "capex": "설비투자 계획의 변화는 향후 현금 사용 규모와 생산능력에 영향을 줄 수 있습니다. 실적 효과가 확정된 것은 아닙니다.",
    "revenue": "매출 관련 수치의 변화는 사업 규모를 이해하는 단서입니다. 수익성이나 주가 방향을 단독으로 설명하지는 않습니다.",
    "operating_income": "영업이익은 영업활동의 수익성을 살펴보는 지표입니다. 일회성 요인과 회계 범위도 함께 확인해야 합니다.",
    "dividend": "배당의 변화는 주주환원 정책을 살펴보는 단서입니다. 지급 조건과 재원을 원문에서 추가로 확인해야 합니다.",
    "guidance": "가이던스는 회사의 전망이며 확정 실적이 아닙니다. 가정과 적용 기간을 함께 확인해야 합니다.",
    "management_change": "경영진 관련 표현이 바뀌었는지 확인할 수 있습니다. 경영 성과에 대한 결론은 추가 근거가 필요합니다.",
    "risk_change": "위험 문구가 달라졌다는 사실만으로 위험의 발생 가능성이나 크기가 확정되지는 않습니다.",
}


def build_brief(document, facts, changes):
    material_changes = [
        c for c in changes if c["change_type"] in ("increased", "decreased", "wording_changed")
    ]
    main = max(material_changes, key=lambda c: c["materiality"]) if material_changes else None
    field = main["field"] if main else (facts[0].field if facts else None)
    label = LABELS.get(field, "공시")
    if main:
        direction = {"increased": "증가", "decreased": "감소", "wording_changed": "문구 변경"}[
            main["change_type"]
        ]
        suffix = f" {main['percentage_change']}%" if main["percentage_change"] is not None else ""
        headline = f"{label} {direction}{suffix}"
    else:
        headline = f"{label} 확인 · 비교 근거 추가 필요"
    return {
        "headline": headline,
        "what_happened": document.title,
        "interpretation": INTERPRETATIONS.get(
            field, "공시 원문에서 확인되는 사실과 미확인 내용을 구분해 검토하세요."
        ),
        "uncertainty": "해석은 일반적인 설명이며 투자 권유가 아닙니다. 비교 가능한 과거 근거가 없으면 변화량을 제시하지 않습니다."
        + (" 합성 데이터로 실제 기업의 공시가 아닙니다." if document.is_demo else ""),
        "monitor_next": "다음 공시에서 같은 지표·기간·통화·회계 범위가 유지되는지, 전망이 실제 결과로 확인되는지 살펴보세요.",
        "template_version": "brief-template-v1",
    }
