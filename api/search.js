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
                    resolve({ status: res.statusCode, data: null, raw: data });
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
        return res.status(500).json({ error: "환경 변수 누락" });
    }
    if (!keyword) {
        return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
    }

    try {
        // 1. 자동완성으로 연관 키워드 수집
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await requestPromise(autoUrl, 'GET', {
            'User-Agent': 'Mozilla/5.0'  // ← 없으면 차단될 수 있음
        }, null);

        let related = [];
        if (autoRes.data?.items?.[0]) {
            related = autoRes.data.items[0]
                .map(item => Array.isArray(item) ? item[0] : item)
                .filter(item => item && item !== keyword)
                .slice(0, 14);
        }

        const apiHeaders = {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json'
        };

        // 2. 검색 트렌드 (일반)
        const fetchSearchTrend = async () => {
            const allKeywords = [keyword, ...related];
            let finalResults = {};

            for (let i = 0; i < allKeywords.length; i += 5) {
                const chunk = allKeywords.slice(i, i + 5);
                const keywordGroups = chunk.map(kw => ({
                    groupName: kw,
                    keywords: [kw]
                }));

                const body = {
                    startDate: "2026-05-01",
                    endDate: "2026-06-15",
                    timeUnit: "month",
                    keywordGroups
                };

                const apiRes = await requestPromise(
                    "https://openapi.naver.com/v1/datalab/search",
                    'POST', apiHeaders, body
                );

                if (apiRes.status === 200 && apiRes.data?.results) {
                    apiRes.data.results.forEach(item => {
                        const maxRatio = item.data?.length > 0
                            ? Math.max(...item.data.map(d => d.ratio))
                            : 0;
                        finalResults[item.title] = Math.max(finalResults[item.title] || 0, maxRatio);
                    });
                } else {
                    console.error('Search trend API error:', apiRes.status, apiRes.data);
                }
            }

            return Object.entries(finalResults)
                .map(([name, score]) => ({ name, score }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 쇼핑 트렌드 - 올바른 API 사용
        const fetchShoppingTrend = async () => {
            const allKeywords = [keyword, ...related];
            let finalResults = {};

            for (let i = 0; i < allKeywords.length; i += 5) {
                const chunk = allKeywords.slice(i, i + 5);

                const body = {
                    startDate: "2026-05-01",
                    endDate: "2026-06-15",
                    timeUnit: "month",
                    keyword: chunk.map(kw => ({ name: kw, param: [kw] }))
                };

                const apiRes = await requestPromise(
                    "https://openapi.naver.com/v1/datalab/shopping/keywords",
                    'POST', apiHeaders, body
                );

                if (apiRes.status === 200 && apiRes.data?.results) {
                    apiRes.data.results.forEach(item => {
                        const maxRatio = item.data?.length > 0
                            ? Math.max(...item.data.map(d => d.ratio))
                            : 0;
                        finalResults[item.title] = Math.max(finalResults[item.title] || 0, maxRatio);
                    });
                } else {
                    console.error('Shopping trend API error:', apiRes.status, apiRes.data);
                }
            }

            return Object.entries(finalResults)
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
