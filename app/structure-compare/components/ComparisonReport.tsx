'use client';

import React from 'react';
import type { ChangeRecord, MappingTable, ComparisonReport as ComparisonReportType } from '@/lib/structure-compare/types';
import { flattenSections } from '@/lib/structure-compare/section-mapper';

interface ComparisonReportProps {
  report: ComparisonReportType;
  v1FileName: string;
  v2FileName: string;
  mappingTable: MappingTable | null;
}

export function ComparisonReport({ report, v1FileName, v2FileName, mappingTable }: ComparisonReportProps) {
  const v1Sections = mappingTable ? flattenSections(mappingTable.v1Outline.sections) : [];
  const v1Map = new Map(v1Sections.map(s => [s.id, s]));

  const structStats = mappingTable ? {
    v1Total: flattenSections(mappingTable.v1Outline.sections).length,
    v2Total: flattenSections(mappingTable.v2Outline.sections).length,
    newCount: mappingTable.entries.filter(e => e.matchType === 'NEW').length,
    deletedCount: mappingTable.entries.filter(e => e.matchType === 'DELETED').length,
    changedCount: mappingTable.entries.filter(e => e.matchType === 'CHANGED').length,
    renumberedCount: mappingTable.entries.filter(e => e.matchType === 'RENUMBERED').length,
  } : null;

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-bold text-slate-900">BÁO CÁO SO SÁNH TÀI LIỆU</h2>
        <table className="mt-3 text-sm">
          <tbody>
            <tr><td className="pr-3 font-medium text-slate-500">V1</td><td className="text-slate-700">{v1FileName}</td></tr>
            <tr><td className="pr-3 font-medium text-slate-500">V2</td><td className="text-slate-700">{v2FileName}</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-sm font-medium text-slate-800">
          Tổng thay đổi: {report.totalChanges}
          {' '}({['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR', 'STRUCTURAL'].map((s, i) =>
            `${i > 0 ? ' | ' : ''}${s}: ${report.changesBySeverity[s] || 0}`
          ).join('')})
        </p>
      </div>

      {/* BẢNG SO SÁNH CHI TIẾT */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-slate-700">BẢNG SO SÁNH CHI TIẾT</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-slate-300 text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-2 text-center w-8">#</th>
                <th className="border border-slate-300 px-3 py-2 text-left w-32">Vị trí</th>
                <th className="border border-slate-300 px-3 py-2 text-left">Hợp đồng V1 (cũ)</th>
                <th className="border border-slate-300 px-3 py-2 text-left">Hợp đồng V2 (mới)</th>
                <th className="border border-slate-300 px-3 py-2 text-left w-64">Đánh giá</th>
              </tr>
            </thead>
            <tbody>
              {report.changes.map((record, idx) => {
                const v1Section = v1Map.get(record.v1SectionId);
                const position = v1Section
                  ? `${v1Section.identifier}${v1Section.title ? ', ' + v1Section.title : ''}`
                  : record.v1SectionId || '—';

                return (
                  <tr key={record.code} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-2 text-center align-top">{idx + 1}</td>
                    <td className="border border-slate-300 px-3 py-2 align-top font-medium text-slate-700">{position}</td>
                    <td className="border border-slate-300 px-3 py-2 align-top text-slate-600 whitespace-pre-wrap">{record.v1Quote}</td>
                    <td className="border border-slate-300 px-3 py-2 align-top text-slate-600 whitespace-pre-wrap">{record.v2Quote}</td>
                    <td className="border border-slate-300 px-3 py-2 align-top">
                      <div className="space-y-1">
                        <div><span className="font-bold">Phân loại:</span> [{record.severity}] - {record.category || '—'}</div>
                        <div><span className="font-bold">Thay đổi:</span> {record.description?.replace(/\\n/g, ' ')}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {report.changes.length === 0 && (
                <tr><td colSpan={5} className="border border-slate-300 px-3 py-6 text-center text-slate-400">Không phát hiện thay đổi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* THỐNG KÊ */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-700">THỐNG KÊ</h3>
          <table className="border-collapse border border-slate-300 text-xs w-full">
            <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-3 py-1.5 text-left">Mức độ</th><th className="border border-slate-300 px-3 py-1.5 text-center w-20">Số lượng</th></tr></thead>
            <tbody>
              {['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR', 'STRUCTURAL'].map(s => (
                <tr key={s}><td className="border border-slate-300 px-3 py-1">[{s}]</td><td className="border border-slate-300 px-3 py-1 text-center">{report.changesBySeverity[s] || 0}</td></tr>
              ))}
              <tr className="font-bold bg-slate-50"><td className="border border-slate-300 px-3 py-1">Tổng</td><td className="border border-slate-300 px-3 py-1 text-center">{report.totalChanges}</td></tr>
            </tbody>
          </table>
        </div>

        {structStats && (
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-700">THAY ĐỔI CẤU TRÚC</h3>
            <table className="border-collapse border border-slate-300 text-xs w-full">
              <thead><tr className="bg-slate-100"><th className="border border-slate-300 px-3 py-1.5 text-left">Hạng mục</th><th className="border border-slate-300 px-3 py-1.5 text-center">V1</th><th className="border border-slate-300 px-3 py-1.5 text-center">V2</th><th className="border border-slate-300 px-3 py-1.5 text-center">Chênh lệch</th></tr></thead>
              <tbody>
                <tr><td className="border border-slate-300 px-3 py-1">Tổng số điều khoản</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.v1Total}</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.v2Total}</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.v2Total - structStats.v1Total >= 0 ? '+' : ''}{structStats.v2Total - structStats.v1Total}</td></tr>
                <tr><td className="border border-slate-300 px-3 py-1">Thêm mới</td><td className="border border-slate-300 px-3 py-1 text-center">—</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.newCount}</td><td className="border border-slate-300 px-3 py-1 text-center">+{structStats.newCount}</td></tr>
                <tr><td className="border border-slate-300 px-3 py-1">Bị xóa</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.deletedCount}</td><td className="border border-slate-300 px-3 py-1 text-center">—</td><td className="border border-slate-300 px-3 py-1 text-center">-{structStats.deletedCount}</td></tr>
                <tr><td className="border border-slate-300 px-3 py-1">Đổi số</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.renumberedCount}</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.renumberedCount}</td><td className="border border-slate-300 px-3 py-1 text-center">0</td></tr>
                <tr><td className="border border-slate-300 px-3 py-1">Sửa nội dung</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.changedCount}</td><td className="border border-slate-300 px-3 py-1 text-center">{structStats.changedCount}</td><td className="border border-slate-300 px-3 py-1 text-center">—</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-slate-400 text-right">
        Tạo lúc: {new Date(report.generatedAt).toLocaleString('vi-VN')}
      </div>
    </div>
  );
}
