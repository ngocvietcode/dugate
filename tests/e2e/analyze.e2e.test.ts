import { submitRequest, pollOperation, createDummyPdfBlob } from './utils';

describe('Analyze API Endpoint', () => {

  const standardModes = ['classify', 'compliance', 'risk', 'fact-check', 'sentiment', 'quality'];

  for (const mode of standardModes) {
    it(`should successfully analyze document using mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('task', mode);
      formData.append('file', createDummyPdfBlob(), 'document.pdf');
      
      const res = await submitRequest('/analyze', formData);
      expect(res.status).toBe(202);
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      const finalState = await pollOperation(operationId);
      
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
      expect(finalState.result.output_format).toBe('json');
    });
  }

  it('should accept additional query/prompt for deeper analysis', async () => {
    const formData = new FormData();
    formData.append('task', 'compliance');
    formData.append('query', 'Hãy tập trung kiểm tra điều khoản bảo mật.');
    formData.append('file', createDummyPdfBlob(), 'document.pdf');
    
    const res = await submitRequest('/analyze', formData);
    expect(res.status).toBe(202);
    
    const resData = await res.json();
    const operationId = resData.name.split('/')[1];
    const finalState = await pollOperation(operationId);
    
    expect(finalState.done).toBe(true);
    expect(finalState.metadata.state).toBe('SUCCEEDED');
  });

});
