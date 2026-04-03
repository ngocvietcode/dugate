import { submitRequest, pollOperation, createDummyPdfBlob } from './utils';

describe('Generate API Endpoint', () => {

  const standardModes = ['summary', 'qa', 'outline', 'report', 'email', 'minutes'];

  for (const mode of standardModes) {
    it(`should generate content based on document using mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('task', mode);
      formData.append('file', createDummyPdfBlob(), 'document.pdf');
      
      // Some modes might benefit from query/prompt
      if (mode === 'qa') {
        formData.append('query', 'Thành phần chính của tài liệu là gì?');
      }

      const res = await submitRequest('/generate', formData);
      expect(res.status).toBe(202);
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      const finalState = await pollOperation(operationId);
      
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
      
      // Text generation modes often output markdown, except maybe JSON if specifically formatted
      expect(['json', 'markdown', 'text'].includes(finalState.result.output_format)).toBeTruthy();
    });
  }

});
