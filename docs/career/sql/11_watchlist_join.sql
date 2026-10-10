-- Current state snapshot, not historical adoption. Keep users with zero saved items.
SELECT u.id AS user_id, count(DISTINCT i.company_id) AS companies
FROM users u LEFT JOIN watchlists w ON w.user_id=u.id
LEFT JOIN watchlist_items i ON i.watchlist_id=w.id
WHERE u.analytics_consent
GROUP BY u.id ORDER BY u.id;
