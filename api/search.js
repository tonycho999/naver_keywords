export default async function handler(req, res) {
    const { keyword } = req.query;
    
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return res.status(500).json({ error: "Vercel 환경 변수에 NAVER_CLIENT_ID와 SECRET을 설정해주세요." });
    }

    try {
        // 1. 네이버 자동완성 기능으로 연관어 14개 가져오기
        const autoRes = await fetch(`https://search.naver.com/OdrSorUrl.nhn?query=${encodeURIComponent(keyword)}`);
        const autoData = await autoRes.json();
        let related = [];
        if (autoData.items && autoData.items[0]) {
            related = autoData.items[0]
                .map(item => item[0])
                .filter(item => item !== keyword)
                .slice(0, 14);
        }

        // 2. 데이터랩 API 호출 준비 함수
        const fetchDatalab = async (url, isShopping = false) => {
            let finalResults = { [keyword]: 0 };
            
            // 14개 연관어를 4개씩 쪼개서 호출 (총 4번 반복)
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                const keywordGroups = [{ groupName: keyword, keywords: [keyword] }];
                chunk.forEach(kw => keywordGroups.push({ groupName: kw, keywords: [kw] }));

                const body = {
                    startDate: "2026-05-01",
                    endDate: "2026-06-15",
                    timeUnit: "month",
                    keywordGroups: keywordGroups
                };
                if (isShopping) body.category = "50000000"; // 패션의류 카테고리 기본값

                const apiRes = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'X-Naver-Client-Id': clientId,
                        'X-Naver-Client-Secret': clientSecret,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                if (apiRes.status === 200) {
                    const apiData = await apiRes.json();
                    apiData.results.forEach(item => {
                        const title = item.title;
                        const maxRatio = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        
                        if (title === keyword) {
                            if (maxRatio > finalResults[keyword]) finalResults[keyword] = maxRatio;
                        } else {
                            finalResults[title] = maxRatio;
                        }
                    });
                }
            }

            // 배열로 변환 후 점수 높은 순 정렬 (상위 15개)
            return Object.entries(finalResults)
                .map(([name, score]) => ({ name, score }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 통합검색 트렌드 및 쇼핑 데이터 각각 찌르기
        const trendData = await fetchDatalab("https://openapi.naver.com/v1/datalab/search", false);
        const shopData = await fetchDatalab("https://openapi.naver.com/v1/datalab/shopping/categories", true);

        return res.status(200).json({ trend: trendData, shop: shopData });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
