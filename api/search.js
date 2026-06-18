const https = require('https');

const requestPromise = (url, method, headers, bodyData) => {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: null });
                }
            });
        });
        req.on('error', (err) => reject(err));
        if (bodyData) req.write(JSON.stringify(bodyData));
        req.end();
    });
};

module.exports = async (req, res) => {
    const { keyword } = req.query;
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return res.status(500).json({ error: '환경변수 누락: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET' });
    }
    if (!keyword) {
        return res.status(400).json({ error: 'keyword 파라미터 필요' });
    }

    try {
        // 1. 자동완성으로 연관 키워드 수집
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await requestPromise(autoUrl, 'GET', { 'User-Agent': 'Mozilla/5.0' }, null);

        let related = [];
        if (autoRes.data?.items?.[0]) {
            related = autoRes.data.items[0]
                .map(item => Array.isArray(item) ? item[0] : item)
                .filter(item => item && item !== keyword)
                .slice(0, 14);
        }

        // keyword를 항상 맨 앞에 포함 (related가 비어도 동작)
        const allKeywords = [keyword, ...related];
        const apiHeaders = {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json'
        };
        const today = new Date();
        const endDate = today.toISOString().slice(0, 10);
        const startDate = new Date(today.setMonth(today.getMonth() - 1)).toISOString().slice(0, 10);

        // 2. 통합 검색 트렌드
        const fetchSearchTrend = async () => {
            const results = {};
            // Naver 제한: keywordGroups 최대 5개, 한 번에 5개씩 처리
            for (let i = 0; i < allKeywords.length; i += 5) {
                const chunk = allKeywords.slice(i, i + 5);
                const body = {
                    startDate,
                    endDate,
                    timeUnit: 'month',
                    keywordGroups: chunk.map(kw => ({ groupName: kw, keywords: [kw] }))
                };
                const apiRes = await requestPromise(
                    'https://openapi.naver.com/v1/datalab/search',
                    'POST', apiHeaders, body
                );
                console.log(`[trend] chunk ${i}~${i+5} status:`, apiRes.status, JSON.stringify(apiRes.data).slice(0, 200));
                if (apiRes.status === 200 && apiRes.data?.results) {
                    apiRes.data.results.forEach(item => {
                        const max = item.data?.length > 0
                            ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            return Object.entries(results)
                .map(([name, score]) => ({ name, score }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 쇼핑 검색 트렌드 — 올바른 API 사용
// fetchShoppingTrend 함수만 아래로 교체

const fetchShoppingTrend = async () => {
    const results = {};
    for (let i = 0; i < allKeywords.length; i += 5) {
        const chunk = allKeywords.slice(i, i + 5);
        const body = {
            startDate,
            endDate,
            timeUnit: 'month',
            category: '50000000',   // 쇼핑 전체 카테고리
            keyword: chunk.map(kw => ({ name: kw, param: [kw] }))
        };
        const apiRes = await requestPromise(
            'https://openapi.naver.com/v1/datalab/shopping/category/keywords',  // 수정
            'POST', apiHeaders, body
        );
        console.log(`[shop] chunk ${i} status:`, apiRes.status, JSON.stringify(apiRes.data).slice(0, 200));
        if (apiRes.status === 200 && apiRes.data?.results) {
            apiRes.data.results.forEach(item => {
                const max = item.data?.length > 0
                    ? Math.max(...item.data.map(d => d.ratio)) : 0;
                results[item.title] = Math.max(results[item.title] || 0, max);
            });
        }
    }
    return Object.entries(results)
        .map(([name, score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
};

        const [trendData, shopData] = await Promise.all([
            fetchSearchTrend(),
            fetchShoppingTrend()
        ]);

        return res.status(200).json({ trend: trendData, shop: shopData });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
