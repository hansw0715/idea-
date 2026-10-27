import { useSearchParams } from "react-router-dom";
import { AppHeader } from "../shell/Shell";
import { Tabs } from "../ui";
import EclassHome from "../school/EclassHome";
import HomeNotices from "./HomeNotices";

/** 학사 상세는 한곳에 두고 홈에는 요약만 제공한다. */
export default function Campus() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "notices" ? "notices" : "learning";
  return (
    <>
      <AppHeader />
      <main id="main" className="app-main campus-page">
        <div className="page-head">
          <h1 className="page-title">학사 알림</h1>
        </div>
        <Tabs
          idBase="campus-tabs"
          label="학사 알림 종류"
          value={tab}
          onChange={(value) => setParams({ tab: value })}
          tabs={[
            { value: "learning", label: "강의·과제 현황" },
            { value: "notices", label: "학교·학과 공지" },
          ]}
        />
        <div
          className="campus-content"
          role="tabpanel"
          id="campus-tabs-panel-learning"
          aria-labelledby="campus-tabs-tab-learning"
          hidden={tab !== "learning"}
        >
          {tab === "learning" && <EclassHome />}
        </div>
        <div
          className="campus-content"
          role="tabpanel"
          id="campus-tabs-panel-notices"
          aria-labelledby="campus-tabs-tab-notices"
          hidden={tab !== "notices"}
        >
          {tab === "notices" && (
            <div className="campus-notices">
              <HomeNotices />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
