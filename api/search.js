// 날짜 포맷 함수 (YYYY-MM-DD)
function getFormattedDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

module.exports = async (req, res) => {
    // 프론트에서 넘어온 keyword와 category 값을 받습니다.
    const { keyword, category } = req.query;
    
    // 네이버 API 키 환경 변수
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) return res.status(500).json({ error: 'API 키 누락 (서버 환경변수를 확인하세요)' });
    if (!keyword) return res.status(400).json({ error: '검색어를 입력해주세요' });
    
    // 카테고리 값이 없으면 기본값으로 패션의류(50000000)를 사용합니다.
    const shopCategory = category || '50000000'; 

    try {
        // 1. 연관어 추출 (네이버 자동완성 API 활용)
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await fetch(autoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const autoData = await autoRes.json();
        
        let related = [];
        if (autoData && autoData.items && autoData.items[0]) {
            related = autoData.items[0]
                .map(item => Array.isArray(item) ? item[0].trim() : item.trim())
                .filter(item => item && item !== keyword.trim())
                .slice(0, 14); // 14개 추출
        }

        const apiHeaders = {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json'
        };

        // 💡 최근 1주일 치 날짜 세팅
        const endDate = getFormattedDate(1);    // 1일 전 (어제 데이터까지 취합됨)
        const startDate = getFormattedDate(7);  // 7일 전

        // 2. 통합 검색 트렌드 조회 (네이버 제한: 한 번에 최대 5개)
        const fetchSearchTrend = async () => {
            const results = { [keyword]: 0 };
            
            // i += 4를 통해 [기준 키워드 1개 + 연관 키워드 4개] = 총 5개씩 묶어서 API 호출
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                const currentKeywords = [keyword, ...chunk]; 
                
                const body = {
                    startDate, endDate,
                    timeUnit: 'date', 
                    keywordGroups: currentKeywords.map(kw => ({ groupName: kw, keywords: [kw] }))
                };
                
                const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
                    method: 'POST', headers: apiHeaders, body: JSON.stringify(body)
                });
                
                // 네이버 서버에서 에러를 뱉었을 경우, 그 원인을 화면에 던짐
                if (!res.ok) {
                    const errData = await res.text();
                    throw new Error(`[통합검색 API 에러] ${res.status} - ${errData}`);
                }

                const data = await res.json();
                if (data.results) {
                    data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            // 검색량이 0인 불필요한 키워드 필터링 및 정렬
            return Object.entries(results)
                .map(([name, score]) => ({ name, score }))
                .filter(item => item.score > 0 || item.name === keyword)
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 쇼핑 검색 트렌드 조회 (💡 네이버 제한: 한 번에 최대 3개까지만 가능)
        const fetchShoppingTrend = async () => {
            const results = { [keyword]: 0 };
            
            // i += 2를 통해 [기준 키워드 1개 + 연관 키워드 2개] = 총 3개씩만 묶어서 API 호출
            for (let i = 0; i < related.length; i += 2) {
                const chunk = related.slice(i, i + 2);
                const currentKeywords = [keyword, ...chunk]; 
                
                const body = {
                    startDate, endDate,
                    timeUnit: 'date',
                    category: shopCategory,
                    keyword: currentKeywords.map(kw => ({ name: kw, param: [kw] }))
                };
                
                const res = await fetch('https://openapi.naver.com/v1/datalab/shopping/category/keywords', {
                    method: 'POST', headers: apiHeaders, body: JSON.stringify(body)
                });

                // 에러 발생 시 원인 그대로 던지기
                if (!res.ok) {
                    const errData = await res.text();
                    throw new Error(`[쇼핑검색 API 에러] ${res.status} - ${errData}`);
                }

                const data = await res.json();
                if (data.results) {
                    data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            // 검색량이 0인 불필요한 키워드 필터링 및 정렬
            return Object.entries(results)
                .map(([name, score]) => ({ name, score }))
                .filter(item => item.score > 0 || item.name === keyword)
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 두 API(통합검색, 쇼핑검색)를 동시에 실행하여 시간을 단축합니다.
        const [trendData, shopData] = await Promise.all([fetchSearchTrend(), fetchShoppingTrend()]);
        return res.status(200).json({ trend: trendData, shop: shopData });

    } catch (error) {
        // 발생한 에러를 프론트엔드로 고스란히 전달합니다.
        return res.status(500).json({ error: error.message });
    }
};
