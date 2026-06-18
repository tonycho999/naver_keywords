const https = require('https');

// 외부 API 호출을 동기식(Promise)으로 처리하기 위한 헬퍼 함수
const requestPromise = (url, method, headers, bodyData) => {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method, headers }, (res) => {
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
        return res.status(500).json({ error: "Vercel 환경 변수에 NAVER_CLIENT_ID와 SECRET을 설정해주세요." });
    }

    try {
        // 1. 네이버 자동완성 연관어 추출
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await requestPromise(autoUrl, 'GET', {}, null);
        
        let related = [];
        if (autoRes.data && autoRes.data.items && autoRes.data.items[0]) {
            related = autoRes.data.items[0]
                .map(item => item[0])
                .filter(item => item !== keyword)
                .slice(0, 14);
        }

        // 2. 데이터랩 조회 헬퍼 함수
        const fetchDatalab = async (targetUrl, isShopping = false) => {
            let finalResults = { [keyword]: 0 };
            
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                const keywordGroups = [{ groupName: keyword, keywords: [keyword] }];
                chunk.forEach(kw => keywordGroups.push({ groupName: kw, keywords: [kw] }));

                const bodyData = {
                    startDate: "2026-05-01",
                    endDate: "2026-06-15",
                    timeUnit: "month",
                    keywordGroups: keywordGroups
                };
                if (isShopping) bodyData.category = "50000000";

                const apiHeaders = {
                    'X-Naver-Client-Id': clientId,
                    'X-Naver-Client-Secret': clientSecret,
                    'Content-Type': 'application/json'
                };

                const apiRes = await requestPromise(targetUrl, 'POST', apiHeaders, bodyData);

                if (apiRes.status === 200 && apiRes.data && apiRes.data.results) {
                    apiRes.data.results.forEach(item => {
                        const title = item.title;
                        const maxRatio = item.data && item.data.length > 0 
                            ? Math.max(...item.data.map(d => d.ratio)) 
                            : 0;
                        
                        if (title === keyword) {
                            if (maxRatio > finalResults[keyword]) finalResults[keyword] = maxRatio;
                        } else {
                            finalResults[title] = maxRatio;
                        }
                    });
                }
            }

            return Object.entries(finalResults)
                .map(([name, score]) => ({ name, score }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 트렌드 및 쇼핑 데이터 획득
        const trendData = await fetchDatalab("https://openapi.naver.com/v1/datalab/search", false);
        const shopData = await fetchDatalab("https://openapi.naver.com/v1/datalab/shopping/categories", true);

        return res.status(200).json({ trend: trendData, shop: shopData });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
