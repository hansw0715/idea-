import { AppHeader } from "../shell/Shell";
import FriendsSection from "../lounge/friends/FriendsSection";

export default function Friends() {
  return (
    <>
      <AppHeader title="친구" backTo="/account" />
      <main id="main" className="app-main friends-page">
        <p className="page-lead">
          친구 요청을 관리하고, 시간표를 보거나 회의에 초대하세요.
        </p>
        <FriendsSection />
      </main>
    </>
  );
}
