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
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } 
                catch (e) { resolve({ status: res.statusCode, data: null }); }
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

    if (!clientId || !clientSecret) return res.status(500).json({ error: 'API 키 누락' });
    if (!keyword) return res.status(400).json({ error: '검색어를 입력해주세요' });

    try {
        // 1. 연관어 추출
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await requestPromise(autoUrl, 'GET', { 'User-Agent': 'Mozilla/5.0' }, null);

        let related = [];
        if (autoRes.data && autoRes.data.items && autoRes.data.items[0]) {
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

        // 💡 핵심 수정 포인트: 넉넉하게 최근 3개월 치를 매일(date) 단위로 조회합니다.
        const endDate = '2026-06-18';
        const startDate = '2026-03-18';

        // 2. 통합 검색 트렌드
        const fetchSearchTrend = async () => {
            const results = { [keyword]: 0 };
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                // 검색된 기준점(keyword)을 항상 맨 앞에 끼워넣어 점수를 정상 비교합니다.
                const currentKeywords = [keyword, ...chunk]; 
                
                const body = {
                    startDate, endDate,
                    timeUnit: 'date', 
                    keywordGroups: currentKeywords.map(kw => ({ groupName: kw, keywords: [kw] }))
                };
                
                const apiRes = await requestPromise('https://openapi.naver.com/v1/datalab/search', 'POST', apiHeaders, body);
                if (apiRes.status === 200 && apiRes.data && apiRes.data.results) {
                    apiRes.data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            return Object.entries(results).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 15);
        };

        // 3. 쇼핑 검색 트렌드
        const fetchShoppingTrend = async () => {
            const results = { [keyword]: 0 };
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                const currentKeywords = [keyword, ...chunk]; 

                const body = {
                    startDate, endDate,
                    timeUnit: 'date',
                    category: '50000000',
                    keyword: currentKeywords.map(kw => ({ name: kw, param: [kw] }))
                };
                
                const apiRes = await requestPromise('https://openapi.naver.com/v1/datalab/shopping/category/keywords', 'POST', apiHeaders, body);
                if (apiRes.status === 200 && apiRes.data && apiRes.data.results) {
                    apiRes.data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            return Object.entries(results).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 15);
        };

        const [trendData, shopData] = await Promise.all([fetchSearchTrend(), fetchShoppingTrend()]);
        return res.status(200).json({ trend: trendData, shop: shopData });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
