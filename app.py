import streamlit as st
import requests
import json
import os

# 1. Vercel 환경변수에서 API 키 불러오기
CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

st.set_page_config(layout="wide")
st.title("📊 네이버 트렌드 & 쇼핑 검색어 15위 분석기")
st.write("검색어를 입력하면 관련 연관어 14개를 추출하여 총 15위까지의 순위를 분석합니다.")

# 2. 네이버 연관어(자동완성) 14개 추출 함수
def get_related_keywords(keyword):
    url = f"https://search.naver.com/OdrSorUrl.nhn?query={keyword}"
    try:
        res = requests.get(url)
        if res.status_code == 200:
            # 네이버 자동완성 로직에서 키워드만 뽑아내기
            items = res.json().get("items", [[]])[0]
            keywords = [item[0] for item in items if item[0] != keyword]
            return keywords[:14] # 최대 14개만 슬라이싱
    except:
        pass
    return []

# 3. 데이터랩 API 호출 및 정규화 함수
def get_datalab_rank(target_url, keyword, related_list, is_shopping=False, category_id="50000000"):
    headers = {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
        "Content-Type": "application/json"
    }
    
    final_results = {}
    # 기준점 키워드 스코어 초기화
    final_results[keyword] = 0.0
    
    # 14개 연관어를 4개씩 쪼개서 API 호출 (총 4회 반복)
    for i in range(0, len(related_list), 4):
        chunk = related_list[i:i+4]
        
        # 키워드 그룹 생성
        kw_groups = [{"groupName": keyword, "keywords": [keyword]}]
        for kw in chunk:
            kw_groups.append({"groupName": kw, "keywords": [kw]})
            
        body = {
            "startDate": "2026-05-01",
            "endDate": "2026-06-15",
            "timeUnit": "month",
            "keywordGroups": kw_groups
        }
        if is_shopping:
            body["category"] = category_id
            
        response = requests.post(target_url, data=json.dumps(body), headers=headers)
        
        if response.status_code == 200:
            data = response.json().get("results", [])
            # 각 키워드별 가장 높은 ratio 값을 추출하여 저장
            for item in data:
                title = item["title"]
                ratios = [data_point["ratio"] for data_point in item.get("data", [])]
                max_ratio = max(ratios) if ratios else 0
                
                # 기준점 대비 상대값을 누적 기록
                if title == keyword:
                    if max_ratio > final_results[keyword]:
                        final_results[keyword] = max_ratio
                else:
                    final_results[title] = max_ratio
                    
    # 정렬 후 상위 15개 반환
    sorted_res = sorted(final_results.items(), key=lambda x: x[1], reverse=True)
    return sorted_res[:15]

# --- UI 구성 ---
user_input = st.text_input("조사할 핵심 검색어를 입력하세요 (예: 캠핑, 원피스, 닭가슴살)", "")

if st.button("조사 시작"):
    if not CLIENT_ID or not CLIENT_SECRET:
        st.error("Vercel Environment Variables에 네이버 API 키를 등록해주세요!")
    elif not user_input:
        st.warning("검색어를 입력해주세요.")
    else:
        with st.spinner("네이버 데이터를 분석 중입니다..."):
            # 1. 연관어 확보
            related = get_related_keywords(user_input)
            
            # 2. API 호출
            trend_url = "https://openapi.naver.com/v1/datalab/search"
            shop_url = "https://openapi.naver.com/v1/datalab/shopping/categories"
            
            trend_rank = get_datalab_rank(trend_url, user_input, related, is_shopping=False)
            shop_rank = get_datalab_rank(shop_url, user_input, related, is_shopping=True)
            
            # 3. 화면 출력 (반으로 쪼개서 시각화)
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("📊 통합 검색 트렌드 순위 (Top 15)")
                for idx, (kw, score) in enumerate(trend_rank, 1):
                    st.write(f"**{idx}위.** {kw} (상대지수: {score:.1f})")
                    st.progress(min(int(score), 100))
                    
            with col2:
                st.subheader("🛒 쇼핑 검색어 클릭 순위 (Top 15)")
                for idx, (kw, score) in enumerate(shop_rank, 1):
                    st.write(f"**{idx}위.** {kw} (상대지수: {score:.1f})")
                    st.progress(min(int(score), 100))
