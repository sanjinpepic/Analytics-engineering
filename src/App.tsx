import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { WarehouseProvider } from './components/Warehouse';
import { Home } from './pages/Home';
import { WorkdayEventPage } from './pages/WorkdayEventPage';
import { TheoryIndex, TheoryModulePage } from './pages/Theory';
import { GymIndex, GymItemPage, Playground } from './pages/Gym';
import { WorkspacePage } from './pages/Workspace';
import { DrillPage, DrillsIndex } from './pages/Drills';
import { ExamIntro, ExamRun } from './pages/Exam';
import { ExamResultPage, ReportPage } from './pages/Results';

export default function App() {
  return (
    <WarehouseProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="workday/:id" element={<WorkdayEventPage />} />
            <Route path="theory" element={<TheoryIndex />} />
            <Route path="theory/:id" element={<TheoryModulePage />} />
            <Route path="gym" element={<GymIndex />} />
            <Route path="gym/playground" element={<Playground />} />
            <Route path="gym/:id" element={<GymItemPage />} />
            <Route path="drills" element={<DrillsIndex />} />
            <Route path="drills/:tpl/:seed" element={<DrillPage />} />
            <Route path="workspace" element={<WorkspacePage />} />
            <Route path="exam" element={<ExamIntro />} />
            <Route path="exam/run" element={<ExamRun />} />
            <Route path="exam/result" element={<ExamResultPage />} />
            <Route path="report" element={<ReportPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </WarehouseProvider>
  );
}
