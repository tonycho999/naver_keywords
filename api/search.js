const https = require('https');

const requestPromise = (url, method, headers, bodyData) => {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method, headers };
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
    const { keyword, category } = req.query;
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) return res.status(500).json({ error: 'API 키 누락' });
    if (!keyword) return res.status(400).json({ error: '검색어를 입력해주세요' });

    // 1. 연관어 추출
    const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
    const autoRes = await requestPromise(autoUrl, 'GET', { 'User-Agent': 'Mozilla/5.0' }, null);

    let related = [];
    if (autoRes.data && autoRes.data.items && autoRes.data.items[0]) {
        related = autoRes.data.items[0].map(item => Array.isArray(item) ? item[0] : item).filter(item => item !== keyword).slice(0, 14);
    }

    // 💡 핵심 수정: 실행 시점에 '어제' 기준으로 날짜를 동적 계산
    const getFormattedDate = (daysAgo) => {
        const d = new Date();
        d.setHours(d.getHours() + 9); // 한국 시간 보정
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().split('T')[0];
    };

    const endDate = getFormattedDate(1);   // 항상 어제
    const startDate = getFormattedDate(7); // 항상 7일 전
    
    const apiHeaders = { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret, 'Content-Type': 'application/json' };
    const shopCategory = category || '50000000';

    // 2. 순차적 데이터 분석 (동적 날짜 적용)
    const fetchResults = async (type) => {
        const finalResults = [{ name: keyword, score: 0 }];
        
        for (const kw of related) {
            const body = {
                startDate, endDate, timeUnit: 'date',
                ...(type === 'shop' ? { category: shopCategory, keyword: [{ name: kw, param: [kw] }] } : 
                                      { keywordGroups: [{ groupName: kw, keywords: [kw] }] })
            };
            
            const url = type === 'shop' ? 'https://openapi.naver.com/v1/datalab/shopping/category/keywords' : 'https://openapi.naver.com/v1/datalab/search';
            const apiRes = await requestPromise(url, 'POST', apiHeaders, body);
            
            if (apiRes.status === 200 && apiRes.data && apiRes.data.results) {
                const item = apiRes.data.results[0];
                const max = (item.data && item.data.length > 0) ? Math.max(...item.data.map(d => d.ratio)) : 0;
                finalResults.push({ name: kw, score: max });
            }
            await new Promise(resolve => setTimeout(resolve, 600)); // 네이버 예의 0.6초
        }
        return finalResults.sort((a, b) => b.score - a.score).slice(0, 15);
    };

    const [trendData, shopData] = await Promise.all([fetchResults('trend'), fetchResults('shop')]);
    return res.status(200).json({ trend: trendData, shop: shopData });
};
