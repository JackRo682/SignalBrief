def test_question_page_feed_window_is_supported(client, headers):
    response = client.get("/v1/feed?days=180&limit=100", headers=headers)
    assert response.status_code == 200
    assert isinstance(response.json()["items"], list)


def test_personal_calendar_creation_matches_list_contract(client, headers):
    response = client.post(
        "/v1/calendar",
        headers=headers,
        json={"title": "Future review", "occurs_on": "2030-01-15", "company_id": None},
    )
    assert response.status_code == 201
    item = response.json()
    assert item["origin"] == "user"
    assert item["occurs_on"] == "2030-01-15"
    assert item["source_url"] is None
    assert item["event_id"] is None
    assert item["company_id"] is None
    assert item["is_demo"] is False
    # The endpoint intentionally defaults to the next 90 days. Query the
    # requested year rather than assuming an event in 2030 is in that window.
    listed = client.get(
        "/v1/calendar?from_date=2030-01-01&until_date=2030-01-31", headers=headers
    ).json()
    assert next(x for x in listed if x["id"] == item["id"]) == item
    assert client.delete(f"/v1/calendar/{item['id']}", headers=headers).status_code == 204
